import { describe, expect, it } from 'vitest';
import { criarMercadoPagoClientFake } from '../../payments/__mocks__/mercado-pago.client.fake.js';
import { criarPaymentsRepositoryFake } from '../../payments/__mocks__/payments.repository.fake.js';
import { criarOrdersRepositoryFake } from '../../orders/__mocks__/orders.repository.fake.js';
import { criarIdempotencyRepositoryFake } from '../../shared/idempotency/__mocks__/idempotency.repository.fake.js';
import { criarPedido, confirmarRecebimentoCliente } from '../../orders/orders.service.js';
import { criarGeradorCobranca, type PaymentsServiceDeps } from '../../payments/payments.service.js';
import { buildApp } from '../app.js';
import { criarMenuRepositoryFake } from '../../menu/__mocks__/menu.repository.fake.js';

describe('POST /v1/webhooks/mercado-pago', () => {
  it('confirma pagamento aprovado e notifica o empreendedor', async () => {
    const mpClient = criarMercadoPagoClientFake();
    const paymentsRepo = criarPaymentsRepositoryFake();
    const ordersRepo = criarOrdersRepositoryFake();
    const notificacoes: string[] = [];

    const criado = await criarPedido(
      ordersRepo,
      { empreendedorId: 'emp-1', itens: [{ itemCardapioId: 'i1', quantidade: 1, precoUnitario: 25 }] },
      20,
    );
    const pedido = await confirmarRecebimentoCliente(ordersRepo, criado.codigoCurto, '5511999998888');
    const gerador = criarGeradorCobranca({ mpClient, paymentsRepo });
    await gerador.gerarCobranca(pedido);
    const pagamento = await paymentsRepo.buscarPorPedidoId(pedido.id);
    mpClient.definirStatusConsulta(pagamento!.idTransacaoExterno, 'approved');

    const paymentsDeps: PaymentsServiceDeps = {
      mpClient,
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
    });

    const resposta = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/mercado-pago',
      payload: { id: 999, type: 'payment', data: { id: pagamento!.idTransacaoExterno } },
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
        mpClient: criarMercadoPagoClientFake(),
        paymentsRepo: criarPaymentsRepositoryFake(),
        ordersRepo: criarOrdersRepositoryFake(),
        idempotency: criarIdempotencyRepositoryFake(),
        notificarEmpreendedor: async () => {},
      },
    });

    const resposta = await app.inject({ method: 'POST', url: '/v1/webhooks/mercado-pago', payload: {} });

    expect(resposta.statusCode).toBe(400);
  });
});
