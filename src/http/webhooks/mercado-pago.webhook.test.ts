import { describe, expect, it } from 'vitest';
import { headersAssinados, SEGREDO_WEBHOOK_TESTE } from './__mocks__/assinar-webhook-mercado-pago.js';
import { criarMercadoPagoClientFake } from '../../payments/__mocks__/mercado-pago.client.fake.js';
import { criarPaymentsRepositoryFake } from '../../payments/__mocks__/payments.repository.fake.js';
import { criarOrdersRepositoryFake } from '../../orders/__mocks__/orders.repository.fake.js';
import { criarIdempotencyRepositoryFake } from '../../shared/idempotency/__mocks__/idempotency.repository.fake.js';
import { criarPedido } from '../../orders/application/criar-pedido.js';
import { levarAoPagamento } from '../../orders/__mocks__/levar-ao-pagamento.js';
import { criarGeradorCobranca } from '../../payments/application/gerar-cobranca.js';
import { type PaymentsServiceDeps } from '../../payments/application/dependencias.js';
import { buildApp } from '../app.js';
import { criarMenuRepositoryFake } from '../../menu/__mocks__/menu.repository.fake.js';

describe('POST /v1/webhooks/mercado-pago', () => {
  it('confirma pagamento aprovado e notifica o empreendedor', async () => {
    const gatewayPix = criarMercadoPagoClientFake();
    const paymentsRepo = criarPaymentsRepositoryFake();
    const ordersRepo = criarOrdersRepositoryFake();
    const notificacoes: string[] = [];

    const criado = await criarPedido(
      ordersRepo,
      { empreendedorId: 'emp-1', itens: [{ itemCardapioId: 'i1', quantidade: 1, precoUnitario: 25 }] },
      20,
    );
    const pedido = await levarAoPagamento(ordersRepo, criado.codigoCurto, '5511999998888');
    const gerador = criarGeradorCobranca({ gatewayPix, paymentsRepo });
    await gerador.gerarCobranca(pedido);
    const pagamento = await paymentsRepo.buscarPorPedidoId(pedido.id);
    gatewayPix.definirStatusConsulta(pagamento!.idTransacaoExterno, 'processed');

    const paymentsDeps: PaymentsServiceDeps = {
      gatewayPix,
      paymentsRepo,
      ordersRepo,
      idempotency: criarIdempotencyRepositoryFake(),
      notificarEmpreendedor: async (p) => {
        notificacoes.push(p.id);
      },
    };

    const app = buildApp({
      menuRepo: criarMenuRepositoryFake(),
      ordersRepo,
      pedidoTtlMinutos: 20,
      frontendAllowedOrigin: 'http://localhost:3001',
      paymentsDeps,
      mercadoPagoWebhookSecret: SEGREDO_WEBHOOK_TESTE,
    });

    const resposta = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/mercado-pago',
      headers: headersAssinados(pagamento!.idTransacaoExterno),
      payload: { id: 999, type: 'order', data: { id: pagamento!.idTransacaoExterno } },
    });

    expect(resposta.statusCode).toBe(200);
    expect(notificacoes).toEqual([pedido.id]);
  });

  it('retorna 400 para payload sem data.id', async () => {
    const app = buildApp({
      menuRepo: criarMenuRepositoryFake(),
      ordersRepo: criarOrdersRepositoryFake(),
      pedidoTtlMinutos: 20,
      frontendAllowedOrigin: 'http://localhost:3001',
      paymentsDeps: {
        gatewayPix: criarMercadoPagoClientFake(),
        paymentsRepo: criarPaymentsRepositoryFake(),
        ordersRepo: criarOrdersRepositoryFake(),
        idempotency: criarIdempotencyRepositoryFake(),
        notificarEmpreendedor: async () => {},
      },
      mercadoPagoWebhookSecret: SEGREDO_WEBHOOK_TESTE,
    });

    const resposta = await app.inject({ method: 'POST', url: '/v1/webhooks/mercado-pago', payload: {} });

    expect(resposta.statusCode).toBe(400);
  });

  it('recusa com 401 e não consulta o Mercado Pago quando a assinatura não bate', async () => {
    const gatewayPix = criarMercadoPagoClientFake();
    let consultas = 0;
    const consultarOriginal = gatewayPix.consultarPagamento.bind(gatewayPix);
    gatewayPix.consultarPagamento = async (id) => {
      consultas++;
      return consultarOriginal(id);
    };
    const app = buildApp({
      menuRepo: criarMenuRepositoryFake(),
      ordersRepo: criarOrdersRepositoryFake(),
      pedidoTtlMinutos: 20,
      frontendAllowedOrigin: 'http://localhost:3001',
      paymentsDeps: {
        gatewayPix,
        paymentsRepo: criarPaymentsRepositoryFake(),
        ordersRepo: criarOrdersRepositoryFake(),
        idempotency: criarIdempotencyRepositoryFake(),
        notificarEmpreendedor: async () => {},
      },
      mercadoPagoWebhookSecret: SEGREDO_WEBHOOK_TESTE,
    });

    const semAssinatura = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/mercado-pago',
      payload: { id: 1, type: 'order', data: { id: 'mp-1' } },
    });
    const assinadaComOutroSegredo = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/mercado-pago',
      headers: headersAssinados('mp-1', 'outro-segredo'),
      payload: { id: 1, type: 'order', data: { id: 'mp-1' } },
    });

    expect(semAssinatura.statusCode).toBe(401);
    expect(assinadaComOutroSegredo.statusCode).toBe(401);
    expect(consultas).toBe(0);
  });
});
