import { beforeEach, describe, expect, it } from 'vitest';
import { criarWhatsAppClientFake, type WhatsAppClientFake } from '../__mocks__/whatsapp-client.fake.js';
import { criarOrdersRepositoryFake } from '../../orders/__mocks__/orders.repository.fake.js';
import { criarIdempotencyRepositoryFake } from '../../shared/idempotency/__mocks__/idempotency.repository.fake.js';
import type { IdempotencyRepository } from '../../shared/idempotency/idempotency.repository.js';
import { criarPedido } from '../../orders/application/criar-pedido.js';
import type { OrdersRepository } from '../../orders/application/ports/orders.repository.js';
import type { Pedido } from '../../orders/domain/pedido.js';
import { registrarOrdersInboundRouter } from './orders-inbound.router.js';
import { type GeradorCobranca } from '../../payments/application/gerar-cobranca.js';
import type { MensagemRecebida } from '../whatsapp-client.interface.js';

function mensagem(overrides: Partial<MensagemRecebida> = {}): MensagemRecebida {
  return { id: 'msg-1', telefone: '5511988887777', corpo: '', timestamp: new Date(), ...overrides };
}

function geradorCobrancaFake(): GeradorCobranca {
  return {
    async gerarCobranca() {
      return { copiaCola: '00020126...pix', qrCodeBase64: 'data:image/png;base64,ABC' };
    },
  };
}

describe('orders-inbound.router', () => {
  let whatsapp: WhatsAppClientFake;
  let ordersRepo: OrdersRepository;
  let pedidosParaALoja: Pedido[];

  function registrar(idempotency: IdempotencyRepository = criarIdempotencyRepositoryFake()) {
    registrarOrdersInboundRouter({
      whatsapp: whatsapp.client,
      ordersRepo,
      idempotency,
      geradorCobranca: geradorCobrancaFake(),
      pedirAceite: async (pedido) => void pedidosParaALoja.push(pedido),
    });
  }

  const novoPedido = () =>
    criarPedido(
      ordersRepo,
      { empreendedorId: 'emp-1', itens: [{ itemCardapioId: 'i1', quantidade: 1, precoUnitario: 25 }] },
      20,
    );

  beforeEach(() => {
    whatsapp = criarWhatsAppClientFake();
    ordersRepo = criarOrdersRepositoryFake();
    pedidosParaALoja = [];
  });

  it('recebe o pedido, avisa o cliente que está com a loja e pede o aceite (sem PIX ainda)', async () => {
    const pedido = await novoPedido();
    registrar();

    await whatsapp.emitirMensagem(mensagem({ corpo: `Confirmar pedido ${pedido.codigoCurto}` }));

    expect(whatsapp.mensagensEnviadas).toHaveLength(1);
    expect(whatsapp.mensagensEnviadas[0]?.conteudo).toContain('aguardar a loja aceitar');
    expect(pedidosParaALoja.map((p) => p.codigoCurto)).toEqual([pedido.codigoCurto]);

    const atualizado = await ordersRepo.buscarPorCodigo(pedido.codigoCurto);
    expect(atualizado?.status).toBe('AGUARDANDO_ACEITE');
    expect(atualizado?.telefoneCliente).toBe('5511988887777');
  });

  it('não pede o aceite de novo quando o cliente repete o código', async () => {
    const pedido = await novoPedido();
    registrar();

    await whatsapp.emitirMensagem(mensagem({ id: 'msg-1', corpo: pedido.codigoCurto }));
    await whatsapp.emitirMensagem(mensagem({ id: 'msg-2', corpo: pedido.codigoCurto }));

    expect(pedidosParaALoja).toHaveLength(1);
    expect(whatsapp.mensagensEnviadas[1]?.conteudo).toContain('ainda está com a loja');
  });

  it('reenvia o PIX quando o pedido já foi aceito e o cliente manda o código de novo', async () => {
    const pedido = await novoPedido();
    registrar();
    await whatsapp.emitirMensagem(mensagem({ id: 'msg-1', corpo: pedido.codigoCurto }));
    await ordersRepo.atualizar(pedido.id, { status: 'AGUARDANDO_PAGAMENTO' });

    await whatsapp.emitirMensagem(mensagem({ id: 'msg-2', corpo: pedido.codigoCurto }));

    expect(whatsapp.mensagensEnviadas.at(-2)?.conteudo).toContain('00020126...pix');
    expect(whatsapp.mensagensEnviadas.at(-1)).toMatchObject({ tipo: 'imagem', conteudo: 'data:image/png;base64,ABC' });
  });

  it('responde com erro amigável quando o código não existe', async () => {
    registrar();

    await whatsapp.emitirMensagem(mensagem({ corpo: 'Confirmar pedido PED-ZZZZ' }));

    expect(whatsapp.mensagensEnviadas[0]?.conteudo).toContain('Não encontrei o pedido PED-ZZZZ');
  });

  it('pede o código quando a mensagem não contém um', async () => {
    registrar();

    await whatsapp.emitirMensagem(mensagem({ corpo: 'oi, quero pagar' }));

    expect(whatsapp.mensagensEnviadas[0]?.conteudo).toContain('Não encontrei o código');
  });

  it('não reprocessa mensagem já marcada como idempotente', async () => {
    const idempotency = criarIdempotencyRepositoryFake();
    await idempotency.marcarProcessado('whatsapp_orders', 'msg-1');
    registrar(idempotency);

    await whatsapp.emitirMensagem(mensagem({ corpo: 'Confirmar pedido PED-ZZZZ' }));

    expect(whatsapp.mensagensEnviadas).toHaveLength(0);
  });
});
