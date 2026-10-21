import { describe, expect, it } from 'vitest';
import { criarWhatsAppClientFake } from '../__mocks__/whatsapp-client.fake.js';
import { criarOrdersRepositoryFake } from '../../orders/__mocks__/orders.repository.fake.js';
import { criarMercadoPagoClientFake } from '../../payments/__mocks__/mercado-pago.client.fake.js';
import { criarPaymentsRepositoryFake } from '../../payments/__mocks__/payments.repository.fake.js';
import { criarGeradorCobranca } from '../../payments/application/gerar-cobranca.js';
import { criarIdempotencyRepositoryFake } from '../../shared/idempotency/__mocks__/idempotency.repository.fake.js';
import { IntegracaoError } from '../../shared/errors/integracao-error.js';
import { criarPedido } from '../../orders/application/criar-pedido.js';
import type { GestaoDeps } from '../../menu/gestao/gestao.service.js';
import { registrarMenuInboundRouter } from '../menu-session/menu-inbound.router.js';
import { reenviarPixPendentes } from './pix-pendente.js';

const LOJA = '5511900000001';
const CLIENTE = '5511988887777';

async function cenario() {
  const loja = criarWhatsAppClientFake();
  const cliente = criarWhatsAppClientFake();
  const ordersRepo = criarOrdersRepositoryFake();
  const paymentsRepo = criarPaymentsRepositoryFake();
  const gateway = criarMercadoPagoClientFake();
  const estado = { mercadoPagoFora: true };
  const criarCobrancaPix = gateway.criarCobrancaPix.bind(gateway);
  gateway.criarCobrancaPix = async (input) => {
    if (estado.mercadoPagoFora) throw new IntegracaoError('mercado_pago', 'Falha (HTTP 502).', true);
    return criarCobrancaPix(input);
  };
  const geradorCobranca = criarGeradorCobranca({ gatewayPix: gateway, paymentsRepo });

  registrarMenuInboundRouter({
    ...({} as GestaoDeps),
    whatsapp: loja.client,
    idempotency: criarIdempotencyRepositoryFake(),
    decisoes: {
      ordersRepo,
      contatos: { telefoneDe: async () => LOJA },
      geradorCobranca,
      clientePedidos: () => cliente.client,
    },
  });

  const pedido = await criarPedido(
    ordersRepo,
    { empreendedorId: 'emp-1', itens: [{ itemCardapioId: 'i1', quantidade: 1, precoUnitario: 30 }] },
    20,
  );
  await ordersRepo.atualizar(pedido.id, { status: 'AGUARDANDO_ACEITE', telefoneCliente: CLIENTE });
  const job = () => reenviarPixPendentes({ ordersRepo, paymentsRepo, geradorCobranca, cliente: () => cliente.client });
  return { loja, cliente, ordersRepo, estado, pedido, job };
}

describe('aceite com PIX que falha', () => {
  it('avisa a loja e o cliente, e o job manda o PIX quando o pagamento volta', async () => {
    const { loja, cliente, ordersRepo, estado, pedido, job } = await cenario();

    await loja.emitirMensagem({
      id: 'l1',
      telefone: LOJA,
      corpo: `aceitar ${pedido.codigoCurto}`,
      timestamp: new Date(),
    });

    expect((await ordersRepo.buscarPorId(pedido.id))?.status).toBe('AGUARDANDO_PAGAMENTO');
    expect(loja.mensagensEnviadas.at(-1)?.conteudo).toContain('mas o PIX não saiu agora');
    expect(cliente.mensagensEnviadas.map((m) => m.conteudo)).toEqual([
      `A loja aceitou seu pedido ${pedido.codigoCurto}! 🎉 O PIX está demorando um pouco: mando aqui em instantes.`,
    ]);

    expect(await job()).toBe(0);

    estado.mercadoPagoFora = false;
    expect(await job()).toBe(1);
    expect(cliente.mensagensEnviadas.map((m) => m.conteudo)).toContain(`Pix copia e cola:\n00020126-pix-${pedido.id}`);

    // Com a cobrança criada, o job não manda de novo.
    expect(await job()).toBe(0);
  });

  it('falha ao avisar o cliente não interrompe: a loja é informada', async () => {
    const { loja, cliente, estado, pedido } = await cenario();
    estado.mercadoPagoFora = false;
    cliente.client.sendText = async () => {
      throw new Error('WhatsApp desconectado');
    };

    await loja.emitirMensagem({
      id: 'l1',
      telefone: LOJA,
      corpo: `aceitar ${pedido.codigoCurto}`,
      timestamp: new Date(),
    });

    expect(loja.mensagensEnviadas.at(-1)?.conteudo).toContain('Não consegui enviar o PIX ao cliente agora');
  });
});
