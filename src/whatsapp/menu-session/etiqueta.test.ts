import { describe, expect, it } from 'vitest';
import { criarWhatsAppClientFake } from '../__mocks__/whatsapp-client.fake.js';
import { criarOrdersRepositoryFake } from '../../orders/__mocks__/orders.repository.fake.js';
import { criarIdempotencyRepositoryFake } from '../../shared/idempotency/__mocks__/idempotency.repository.fake.js';
import { criarPedido } from '../../orders/application/criar-pedido.js';
import type { Pedido } from '../../orders/domain/pedido.js';
import type { GestaoDeps } from '../../menu/gestao/gestao.service.js';
import { DomainError } from '../../shared/errors/domain-error.js';
import { registrarMenuInboundRouter } from './menu-inbound.router.js';

const TELEFONE_LOJA = '5511900000001';
const TELEFONE_CLIENTE = '5511988887777';

async function cenario(status: Pedido['status'] = 'PAGO', gerar?: (pedido: Pedido) => Promise<{ etiquetaId: string; pdf: Uint8Array; rastreio?: string; transportadora: string }>) {
  const loja = criarWhatsAppClientFake();
  const cliente = criarWhatsAppClientFake();
  const ordersRepo = criarOrdersRepositoryFake();
  registrarMenuInboundRouter({
    ...({} as GestaoDeps),
    whatsapp: loja.client,
    idempotency: criarIdempotencyRepositoryFake(),
    decisoes: {
      ordersRepo,
      contatos: { telefoneDe: async () => TELEFONE_LOJA },
      geradorCobranca: { gerarCobranca: async () => ({ copiaCola: 'pix' }) },
      clientePedidos: () => cliente.client,
      gerarEtiqueta: gerar ?? (async () => ({ etiquetaId: 'etq-1', pdf: new Uint8Array([1]), rastreio: 'BR123', transportadora: 'Correios' })),
    },
  });
  const criado = await criarPedido(ordersRepo, { empreendedorId: 'emp-1', itens: [{ itemCardapioId: 'i1', quantidade: 1, precoUnitario: 50 }] }, 20, new Date(), {
    modalidade: 'MELHOR_ENVIO',
    servicoEnvio: { id: '1', nome: 'PAC', empresa: 'Correios', preco: 20 },
  });
  const pedido = await ordersRepo.atualizar(criado.id, { status, telefoneCliente: TELEFONE_CLIENTE });
  const mandar = (corpo: string) => loja.emitirMensagem({ id: `m-${corpo}`, telefone: TELEFONE_LOJA, corpo, timestamp: new Date() });
  return { loja, cliente, ordersRepo, pedido, mandar };
}

describe('gestão: "gerar etiqueta do PED-XXXX"', () => {
  it('manda o PDF para a loja, marca ENVIADO com o rastreio e avisa o cliente', async () => {
    const { loja, cliente, ordersRepo, pedido, mandar } = await cenario();

    await mandar(`gerar etiqueta do ${pedido.codigoCurto}`);

    expect(loja.mensagensEnviadas.find((m) => m.tipo === 'documento')).toMatchObject({
      conteudo: `etiqueta-${pedido.codigoCurto}.pdf`,
      legenda: expect.stringContaining('Imprima e cole no pacote'),
    });
    expect(await ordersRepo.buscarPorId(pedido.id)).toMatchObject({ status: 'ENVIADO', etiquetaId: 'etq-1', codigoRastreio: 'BR123', transportadora: 'Correios' });
    expect(cliente.mensagensEnviadas.at(-1)?.conteudo).toContain('BR123');
  });

  it('erro de regra (ainda não pago) volta como texto para a loja', async () => {
    const { loja, pedido, mandar } = await cenario('AGUARDANDO_PAGAMENTO', async () => {
      throw new DomainError('A etiqueta sai depois do pagamento.', 'ETIQUETA_INDISPONIVEL');
    });
    await mandar(`gerar etiqueta do ${pedido.codigoCurto}`);
    expect(loja.mensagensEnviadas.at(-1)?.conteudo).toBe('A etiqueta sai depois do pagamento.');
  });

  it('falha do Melhor Envio: pede para conferir o saldo', async () => {
    const { loja, pedido, mandar } = await cenario('PAGO', async () => {
      throw new Error('saldo insuficiente');
    });
    await mandar(`gerar etiqueta do ${pedido.codigoCurto}`);
    expect(loja.mensagensEnviadas.at(-1)?.conteudo).toContain('Confira o saldo');
  });
});
