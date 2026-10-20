import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarOrdersRepositoryFake } from './__mocks__/orders.repository.fake.js';
import { criarPedido } from './orders.service.js';
import { iniciarJobExpiracaoPedidos } from './order-expiration.job.js';

describe('iniciarJobExpiracaoPedidos', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('expira pedidos vencidos a cada intervalo', async () => {
    const ordersRepo = criarOrdersRepositoryFake();
    const agora = new Date();
    const vencido = await criarPedido(
      ordersRepo,
      { empreendedorId: 'emp-1', itens: [{ itemCardapioId: 'i1', quantidade: 1, precoUnitario: 10 }] },
      -1,
      agora,
    );

    const timer = iniciarJobExpiracaoPedidos(ordersRepo, 1000);
    await vi.advanceTimersByTimeAsync(1000);

    const pedidoAtualizado = await ordersRepo.buscarPorCodigo(vencido.codigoCurto);
    expect(pedidoAtualizado?.status).toBe('EXPIRADO');

    clearInterval(timer);
  });
});
