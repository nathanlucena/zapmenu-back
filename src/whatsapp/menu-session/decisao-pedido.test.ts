import { beforeEach, describe, expect, it } from 'vitest';
import { criarWhatsAppClientFake, type WhatsAppClientFake } from '../__mocks__/whatsapp-client.fake.js';
import { criarOrdersRepositoryFake } from '../../orders/__mocks__/orders.repository.fake.js';
import { criarIdempotencyRepositoryFake } from '../../shared/idempotency/__mocks__/idempotency.repository.fake.js';
import { criarPedido } from '../../orders/application/criar-pedido.js';
import { pedirAceiteDaLoja } from '../../orders/application/pedir-aceite-da-loja.js';
import type { OrdersRepository } from '../../orders/application/ports/orders.repository.js';
import type { Pedido } from '../../orders/domain/pedido.js';
import type { GestaoDeps } from '../../menu/gestao/gestao.service.js';
import type { GeradorCobranca } from '../../payments/application/gerar-cobranca.js';
import { registrarOrdersInboundRouter } from '../orders-session/orders-inbound.router.js';
import { registrarMenuInboundRouter } from './menu-inbound.router.js';

const TELEFONE_LOJA = '5511900000001';
const TELEFONE_CLIENTE = '5511988887777';

describe('loja aceita ou recusa o pedido antes do PIX', () => {
  let cliente: WhatsAppClientFake;
  let loja: WhatsAppClientFake;
  let ordersRepo: OrdersRepository;
  let pedido: Pedido;
  let pixGerados: string[];

  beforeEach(async () => {
    cliente = criarWhatsAppClientFake();
    loja = criarWhatsAppClientFake();
    ordersRepo = criarOrdersRepositoryFake();
    pixGerados = [];
    const contatos = { telefoneDe: async () => TELEFONE_LOJA };
    const geradorCobranca: GeradorCobranca = {
      async gerarCobranca(p) {
        pixGerados.push(p.codigoCurto);
        return { copiaCola: '00020126...pix' };
      },
    };
    const idempotency = criarIdempotencyRepositoryFake();

    registrarOrdersInboundRouter({
      whatsapp: cliente.client,
      ordersRepo,
      idempotency,
      geradorCobranca,
      pedirAceite: (p) =>
        pedirAceiteDaLoja(
          {
            ordersRepo,
            contatos,
            mensageiro: {
              enviarTexto: (telefone, texto) => loja.client.sendText(telefone, texto),
              enviarEnquete: (telefone, pergunta, opcoes) => loja.client.sendPoll(telefone, pergunta, opcoes),
            },
          },
          p,
        ),
    });
    registrarMenuInboundRouter({
      // A conversa de gestão não pode ser chamada: estas deps vazias quebrariam o teste.
      ...({} as GestaoDeps),
      whatsapp: loja.client,
      idempotency,
      decisoes: { ordersRepo, contatos, geradorCobranca, clientePedidos: () => cliente.client },
    });

    pedido = await criarPedido(
      ordersRepo,
      {
        empreendedorId: 'emp-1',
        itens: [
          { itemCardapioId: 'i1', quantidade: 2, precoUnitario: 47, variacaoEscolhida: { Tamanho: 'Grande (G)' }, observacao: 'bem assada' },
        ],
      },
      20,
    );
    await cliente.emitirMensagem({ id: 'c1', telefone: TELEFONE_CLIENTE, corpo: `Quero confirmar o pedido ${pedido.codigoCurto}`, timestamp: new Date() });
  });

  const enquete = () => loja.mensagensEnviadas.find((m) => m.tipo === 'enquete')!;
  const votar = (opcao: string, telefone = TELEFONE_LOJA, id = 'v1') =>
    loja.emitirVoto({ id, telefone, enqueteId: enquete().enqueteId!, opcoes: [opcao] });
  const status = async () => (await ordersRepo.buscarPorId(pedido.id))?.status;

  it('manda o resumo do pedido e a enquete para a loja', async () => {
    const resumo = loja.mensagensEnviadas[0]!;
    expect(resumo).toMatchObject({ telefone: TELEFONE_LOJA, tipo: 'texto' });
    expect(resumo.conteudo).toContain('2x Item (Tamanho: Grande (G)) — R$ 94.00');
    expect(resumo.conteudo).toContain('📝 bem assada');
    expect(resumo.conteudo).toContain('Total: R$ 94.00');
    expect(enquete()).toMatchObject({ opcoes: ['Aceitar', 'Recusar'] });
    expect((await ordersRepo.buscarPorId(pedido.id))?.enqueteAceiteId).toBe(enquete().enqueteId);
    expect(pixGerados).toEqual([]);
  });

  it('voto em Aceitar: pedido vai para pagamento e o PIX vai para o cliente', async () => {
    await votar('Aceitar');

    expect(await status()).toBe('AGUARDANDO_PAGAMENTO');
    expect(pixGerados).toEqual([pedido.codigoCurto]);
    expect(cliente.mensagensEnviadas.map((m) => m.conteudo)).toEqual([
      expect.stringContaining('aguardar a loja aceitar'),
      expect.stringContaining('A loja aceitou seu pedido'),
      'Pix copia e cola:\n00020126...pix',
    ]);
    expect(loja.mensagensEnviadas.at(-1)?.conteudo).toBe(`Pedido ${pedido.codigoCurto} aceito ✅ O PIX foi enviado ao cliente.`);
  });

  it('"recusar PED-XXXX" em texto: pedido recusado e cliente avisado, sem PIX', async () => {
    await loja.emitirMensagem({ id: 'l1', telefone: TELEFONE_LOJA, corpo: `recusar ${pedido.codigoCurto}`, timestamp: new Date() });

    expect(await status()).toBe('RECUSADO');
    expect(pixGerados).toEqual([]);
    expect(cliente.mensagensEnviadas.at(-1)?.conteudo).toContain('A loja não pôde aceitar seu pedido');
  });

  it('ignora a decisão de quem não é o dono da loja', async () => {
    await votar('Aceitar', '5511911112222');

    expect(await status()).toBe('AGUARDANDO_ACEITE');
    expect(loja.mensagensEnviadas.at(-1)?.conteudo).toContain('não é da sua loja');
  });

  it('só a primeira decisão vale', async () => {
    await votar('Aceitar', TELEFONE_LOJA, 'v1');
    await votar('Recusar', TELEFONE_LOJA, 'v2');

    expect(await status()).toBe('AGUARDANDO_PAGAMENTO');
    expect(loja.mensagensEnviadas.at(-1)?.conteudo).toContain('já foi respondido');
  });

  it('pagamento na entrega: aceitar confirma o pedido sem PIX e avisa como pagar', async () => {
    const naEntrega = await criarPedido(
      ordersRepo,
      { empreendedorId: 'emp-1', itens: [{ itemCardapioId: 'i1', quantidade: 1, precoUnitario: 47 }] },
      20,
      new Date(),
      { modalidade: 'ENTREGA', formaPagamento: 'DINHEIRO', trocoPara: 100 },
    );
    await cliente.emitirMensagem({ id: 'c2', telefone: TELEFONE_CLIENTE, corpo: naEntrega.codigoCurto, timestamp: new Date() });
    expect(loja.mensagensEnviadas.at(-2)?.conteudo).toContain('Total: R$ 47.00 — Dinheiro na entrega (troco para R$ 100.00)');

    await loja.emitirMensagem({ id: 'l2', telefone: TELEFONE_LOJA, corpo: `aceitar ${naEntrega.codigoCurto}`, timestamp: new Date() });

    expect((await ordersRepo.buscarPorId(naEntrega.id))?.status).toBe('CONFIRMADO');
    expect(pixGerados).toEqual([]);
    expect(cliente.mensagensEnviadas.at(-1)?.conteudo).toContain('Pagamento: Dinheiro na entrega (troco para R$ 100.00) — R$ 47.00');
    const confirmacao = loja.mensagensEnviadas.at(-2)?.conteudo;
    expect(confirmacao).toContain('aceito ✅ Pagamento: Dinheiro na entrega');
    expect(confirmacao).toContain(`📞 wa.me/${TELEFONE_CLIENTE}`);

    // Já em preparo: a loja recebe a enquete de andamento.
    const andamento = loja.mensagensEnviadas.at(-1)!;
    expect(andamento).toMatchObject({ tipo: 'enquete', opcoes: ['Saiu para entrega', 'Entregue'] });

    await loja.emitirVoto({ id: 'v-saiu', telefone: TELEFONE_LOJA, enqueteId: andamento.enqueteId!, opcoes: ['Saiu para entrega'] });
    expect((await ordersRepo.buscarPorId(naEntrega.id))?.status).toBe('SAIU_PARA_ENTREGA');
    expect(cliente.mensagensEnviadas.at(-1)?.conteudo).toBe(
      `Seu pedido ${naEntrega.codigoCurto} saiu para entrega 🛵\nPagamento: Dinheiro na entrega (troco para R$ 100.00) — R$ 47.00.`,
    );

    // Trocar o voto na mesma enquete conclui; a resposta em texto também funciona e não repete.
    await loja.emitirVoto({ id: 'v-entregue', telefone: TELEFONE_LOJA, enqueteId: andamento.enqueteId!, opcoes: ['Entregue'] });
    expect((await ordersRepo.buscarPorId(naEntrega.id))?.status).toBe('CONCLUIDO');
    await loja.emitirMensagem({ id: 'l3', telefone: TELEFONE_LOJA, corpo: `entregue ${naEntrega.codigoCurto}`, timestamp: new Date() });
    expect(loja.mensagensEnviadas.at(-1)?.conteudo).toContain('já está como "concluído"');
  });

  it('etapas do varejo em texto: separei, enviei com rastreio e entreguei, avisando o cliente uma vez por etapa', async () => {
    const encomenda = await criarPedido(
      ordersRepo,
      { empreendedorId: 'emp-1', itens: [{ itemCardapioId: 'camiseta', quantidade: 1, precoUnitario: 60 }] },
      20,
      new Date(),
      { modalidade: 'ENTREGA', formaPagamento: 'CARTAO' },
    );
    await cliente.emitirMensagem({ id: 'c3', telefone: TELEFONE_CLIENTE, corpo: encomenda.codigoCurto, timestamp: new Date() });
    await loja.emitirMensagem({ id: 'l4', telefone: TELEFONE_LOJA, corpo: `aceitar ${encomenda.codigoCurto}`, timestamp: new Date() });
    const statusDaEncomenda = async () => (await ordersRepo.buscarPorId(encomenda.id))?.status;
    const avisosAoCliente = () => cliente.mensagensEnviadas.length;

    await loja.emitirMensagem({ id: 'l5', telefone: TELEFONE_LOJA, corpo: `separei ${encomenda.codigoCurto}`, timestamp: new Date() });
    expect(await statusDaEncomenda()).toBe('SEPARADO');
    expect(cliente.mensagensEnviadas.at(-1)?.conteudo).toBe(
      `Seu pedido ${encomenda.codigoCurto} foi separado 📦 Avisamos quando sair.`,
    );
    expect(loja.mensagensEnviadas.at(-1)?.conteudo).toBe(`Pedido ${encomenda.codigoCurto}: separado ✅ Cliente avisado.`);

    await loja.emitirMensagem({
      id: 'l6',
      telefone: TELEFONE_LOJA,
      corpo: `enviei ${encomenda.codigoCurto} rastreio NX123456789BR`,
      timestamp: new Date(),
    });
    expect(await ordersRepo.buscarPorId(encomenda.id)).toMatchObject({
      status: 'ENVIADO',
      codigoRastreio: 'NX123456789BR',
      transportadora: 'Correios',
    });
    expect(cliente.mensagensEnviadas.at(-1)?.conteudo).toBe(
      `Seu pedido ${encomenda.codigoCurto} foi enviado pelos Correios 🚚\nCódigo de rastreio: NX123456789BR\nPagamento: Cartão na entrega — R$ 60.00.`,
    );

    // A mesma etapa de novo não muda nada nem avisa o cliente outra vez.
    const antes = avisosAoCliente();
    await loja.emitirMensagem({ id: 'l7', telefone: TELEFONE_LOJA, corpo: `enviei ${encomenda.codigoCurto}`, timestamp: new Date() });
    expect(avisosAoCliente()).toBe(antes);
    expect(loja.mensagensEnviadas.at(-1)?.conteudo).toContain('já está como "enviado"');

    await loja.emitirMensagem({ id: 'l8', telefone: TELEFONE_LOJA, corpo: `entreguei ${encomenda.codigoCurto}`, timestamp: new Date() });
    expect(await statusDaEncomenda()).toBe('CONCLUIDO');
    expect(cliente.mensagensEnviadas.at(-1)?.conteudo).toContain('concluído');
  });

  it('"pronto PED-XXXX" antes do pagamento é recusado com explicação', async () => {
    await loja.emitirMensagem({ id: 'l9', telefone: TELEFONE_LOJA, corpo: `pronto ${pedido.codigoCurto}`, timestamp: new Date() });

    expect(await status()).toBe('AGUARDANDO_ACEITE');
    expect(loja.mensagensEnviadas.at(-1)?.conteudo).toContain('ainda não foi pago ou aceito');
  });
});
