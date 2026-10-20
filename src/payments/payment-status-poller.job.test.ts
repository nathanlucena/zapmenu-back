import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarMercadoPagoClientFake } from './__mocks__/mercado-pago.client.fake.js';
import { criarPaymentsRepositoryFake } from './__mocks__/payments.repository.fake.js';
import { criarOrdersRepositoryFake } from '../orders/__mocks__/orders.repository.fake.js';
import { criarPedido, confirmarRecebimentoCliente } from '../orders/orders.service.js';
import { criarGeradorCobranca } from './payments.service.js';
import { iniciarJobPollingPagamentos } from './payment-status-poller.job.js';
import type { Pedido } from '../orders/orders.types.js';

describe('iniciarJobPollingPagamentos', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('detecta pagamento aprovado via polling e notifica o empreendedor', async () => {
    const mpClient = criarMercadoPagoClientFake();
    const paymentsRepo = criarPaymentsRepositoryFake();
    const ordersRepo = criarOrdersRepositoryFake();
    const notificacoes: Pedido[] = [];

    const criado = await criarPedido(
      ordersRepo,
      { empreendedorId: 'emp-1', itens: [{ itemCardapioId: 'i1', quantidade: 1, precoUnitario: 10 }] },
      20,
    );
    const pedido = await confirmarRecebimentoCliente(ordersRepo, criado.codigoCurto, '5511999998888');
    await criarGeradorCobranca({ mpClient, paymentsRepo }).gerarCobranca(pedido);
    const pagamento = await paymentsRepo.buscarPorPedidoId(pedido.id);
    mpClient.definirStatusConsulta(pagamento!.idTransacaoExterno, 'approved');

    const timer = iniciarJobPollingPagamentos(
      { mpClient, paymentsRepo, ordersRepo, notificarEmpreendedor: async (p) => void notificacoes.push(p) },
      1000,
      0,
    );
    await vi.advanceTimersByTimeAsync(1000);
    clearInterval(timer);

    const pedidoAtualizado = await ordersRepo.buscarPorId(pedido.id);
    expect(pedidoAtualizado?.status).toBe('PAGO');
    expect(notificacoes).toHaveLength(1);
  });
});
