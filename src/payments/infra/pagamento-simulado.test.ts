import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarMercadoPagoClientFake } from '../__mocks__/mercado-pago.client.fake.js';
import { criarPaymentsRepositoryFake } from '../__mocks__/payments.repository.fake.js';
import { criarOrdersRepositoryFake } from '../../orders/__mocks__/orders.repository.fake.js';
import { criarPedido } from '../../orders/application/criar-pedido.js';
import { levarAoPagamento } from '../../orders/__mocks__/levar-ao-pagamento.js';
import type { Pedido } from '../../orders/domain/pedido.js';
import { criarGeradorCobranca } from '../application/gerar-cobranca.js';
import { aplicarStatusPagamento } from '../application/aplicar-status-pagamento.js';
import { comPagamentoSimulado, type OpcoesPagamentoSimulado } from './pagamento-simulado.js';

async function cenario(opcoes: OpcoesPagamentoSimulado) {
  const gatewayPix = criarMercadoPagoClientFake();
  const paymentsRepo = criarPaymentsRepositoryFake();
  const ordersRepo = criarOrdersRepositoryFake();
  const notificacoes: Pedido[] = [];
  const deps = { paymentsRepo, ordersRepo, notificarEmpreendedor: async (p: Pedido) => void notificacoes.push(p) };

  const criado = await criarPedido(
    ordersRepo,
    { empreendedorId: 'emp-1', itens: [{ itemCardapioId: 'i1', quantidade: 1, precoUnitario: 10 }] },
    20,
  );
  const pedido = await levarAoPagamento(ordersRepo, criado.codigoCurto, '5511999998888');
  const gerador = comPagamentoSimulado(criarGeradorCobranca({ gatewayPix, paymentsRepo }), deps, opcoes);
  await gerador.gerarCobranca(pedido);

  return { pedido, paymentsRepo, ordersRepo, notificacoes, deps };
}

describe('comPagamentoSimulado', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aprova o pagamento N segundos depois de gerar a cobrança', async () => {
    const { pedido, paymentsRepo, ordersRepo, notificacoes } = await cenario({ modoAutoteste: true, segundos: 30 });

    await vi.advanceTimersByTimeAsync(29_000);
    expect((await ordersRepo.buscarPorId(pedido.id))?.status).toBe('AGUARDANDO_PAGAMENTO');

    await vi.advanceTimersByTimeAsync(1_000);
    expect((await ordersRepo.buscarPorId(pedido.id))?.status).toBe('PAGO');
    expect((await paymentsRepo.buscarPorPedidoId(pedido.id))?.status).toBe('APROVADO');
    expect(notificacoes).toHaveLength(1);
  });

  it('não faz nada se o pedido já foi pago antes', async () => {
    const { pedido, paymentsRepo, notificacoes, deps } = await cenario({ modoAutoteste: true, segundos: 30 });
    await aplicarStatusPagamento(deps, (await paymentsRepo.buscarPorPedidoId(pedido.id))!, 'APROVADO', new Date());

    await vi.advanceTimersByTimeAsync(30_000);
    expect(notificacoes).toHaveLength(1);
  });

  it.each([
    { modoAutoteste: false, segundos: 30 },
    { modoAutoteste: true, segundos: 0 },
  ])('fica desligado com %o', async (opcoes) => {
    const { pedido, ordersRepo, notificacoes } = await cenario(opcoes);

    await vi.advanceTimersByTimeAsync(60_000);
    expect((await ordersRepo.buscarPorId(pedido.id))?.status).toBe('AGUARDANDO_PAGAMENTO');
    expect(notificacoes).toHaveLength(0);
  });
});
