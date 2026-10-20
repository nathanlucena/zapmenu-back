import { beforeEach, describe, expect, it } from 'vitest';
import { criarMercadoPagoClientFake, type MercadoPagoClientFake } from './__mocks__/mercado-pago.client.fake.js';
import { criarPaymentsRepositoryFake } from './__mocks__/payments.repository.fake.js';
import { criarOrdersRepositoryFake } from '../orders/__mocks__/orders.repository.fake.js';
import { criarIdempotencyRepositoryFake } from '../shared/idempotency/__mocks__/idempotency.repository.fake.js';
import { criarPedido } from '../orders/application/criar-pedido.js';
import { confirmarRecebimentoCliente } from '../orders/application/confirmar-recebimento-cliente.js';
import type { OrdersRepository } from '../orders/application/ports/orders.repository.js';
import type { IdempotencyRepository } from '../shared/idempotency/idempotency.repository.js';
import type { PaymentsRepository } from './application/ports/payments.repository.js';
import type { Pedido } from '../orders/domain/pedido.js';
import { criarGeradorCobranca } from './application/gerar-cobranca.js';
import { mapearStatusMercadoPago } from './domain/pagamento.js';
import { pollarPagamentosPendentes } from './application/pollar-pagamentos-pendentes.js';
import { processarNotificacaoPagamento } from './application/processar-notificacao-pagamento.js';
import { type PaymentsServiceDeps } from './application/dependencias.js';

describe('mapearStatusMercadoPago', () => {
  it('mapeia status conhecidos', () => {
    expect(mapearStatusMercadoPago('processed')).toBe('APROVADO');
    expect(mapearStatusMercadoPago('action_required')).toBe('PENDENTE');
    expect(mapearStatusMercadoPago('failed')).toBe('REJEITADO');
    expect(mapearStatusMercadoPago('canceled')).toBe('REJEITADO');
    expect(mapearStatusMercadoPago('expired')).toBe('EXPIRADO');
  });

  it('usa PENDENTE como fallback para status desconhecido', () => {
    expect(mapearStatusMercadoPago('algo_novo')).toBe('PENDENTE');
  });
});

async function criarPedidoConfirmado(ordersRepo: OrdersRepository): Promise<Pedido> {
  const agora = new Date('2026-01-01T10:00:00Z');
  const criado = await criarPedido(
    ordersRepo,
    { empreendedorId: 'emp-1', itens: [{ itemCardapioId: 'i1', quantidade: 1, precoUnitario: 25 }] },
    20,
    agora,
  );
  return confirmarRecebimentoCliente(ordersRepo, criado.codigoCurto, '5511999998888', agora);
}

describe('criarGeradorCobranca', () => {
  let gatewayPix: MercadoPagoClientFake;
  let paymentsRepo: PaymentsRepository;
  let ordersRepo: OrdersRepository;

  beforeEach(() => {
    gatewayPix = criarMercadoPagoClientFake();
    paymentsRepo = criarPaymentsRepositoryFake();
    ordersRepo = criarOrdersRepositoryFake();
  });

  it('gera nova cobrança e persiste o pagamento', async () => {
    const pedido = await criarPedidoConfirmado(ordersRepo);
    const gerador = criarGeradorCobranca({ gatewayPix, paymentsRepo });

    const cobranca = await gerador.gerarCobranca(pedido);

    expect(cobranca.copiaCola).toContain(pedido.id);
    expect(cobranca.qrCodeBase64).toBe('data:image/png;base64,FAKE');

    const persistido = await paymentsRepo.buscarPorPedidoId(pedido.id);
    expect(persistido?.status).toBe('PENDENTE');
  });

  it('reutiliza cobrança existente sem chamar o Mercado Pago de novo', async () => {
    const pedido = await criarPedidoConfirmado(ordersRepo);
    const gerador = criarGeradorCobranca({ gatewayPix, paymentsRepo });

    const primeira = await gerador.gerarCobranca(pedido);
    const segunda = await gerador.gerarCobranca(pedido);

    expect(segunda).toEqual(primeira);
    const todosPagamentos = await paymentsRepo.buscarPorPedidoId(pedido.id);
    expect(todosPagamentos).not.toBeNull();
  });
});

describe('processarNotificacaoPagamento', () => {
  let deps: PaymentsServiceDeps;
  let ordersRepo: OrdersRepository;
  let paymentsRepo: PaymentsRepository;
  let idempotency: IdempotencyRepository;
  let notificacoes: Pedido[];
  let gateway: MercadoPagoClientFake;

  beforeEach(() => {
    gateway = criarMercadoPagoClientFake();
    paymentsRepo = criarPaymentsRepositoryFake();
    ordersRepo = criarOrdersRepositoryFake();
    idempotency = criarIdempotencyRepositoryFake();
    notificacoes = [];
    deps = {
      gatewayPix: gateway,
      paymentsRepo,
      ordersRepo,
      idempotency,
      notificarEmpreendedor: async (pedido) => {
        notificacoes.push(pedido);
      },
    };
  });

  it('confirma pagamento aprovado, marca pedido como PAGO e notifica o empreendedor', async () => {
    const pedido = await criarPedidoConfirmado(ordersRepo);
    const gerador = criarGeradorCobranca(deps);
    await gerador.gerarCobranca(pedido);
    const pagamento = await paymentsRepo.buscarPorPedidoId(pedido.id);

    gateway.definirStatusConsulta(pagamento!.idTransacaoExterno, 'processed');

    await processarNotificacaoPagamento(deps, {
      eventoId: 'evt-1',
      idTransacaoExterno: pagamento!.idTransacaoExterno,
    });

    const pedidoAtualizado = await ordersRepo.buscarPorId(pedido.id);
    expect(pedidoAtualizado?.status).toBe('PAGO');
    expect(notificacoes).toHaveLength(1);
    expect(notificacoes[0]?.id).toBe(pedido.id);
  });

  it('ignora reenvio do mesmo evento de webhook (idempotência)', async () => {
    const pedido = await criarPedidoConfirmado(ordersRepo);
    const gerador = criarGeradorCobranca(deps);
    await gerador.gerarCobranca(pedido);
    const pagamento = await paymentsRepo.buscarPorPedidoId(pedido.id);

    gateway.definirStatusConsulta(pagamento!.idTransacaoExterno, 'processed');

    const evento = { eventoId: 'evt-1', idTransacaoExterno: pagamento!.idTransacaoExterno };
    await processarNotificacaoPagamento(deps, evento);
    await processarNotificacaoPagamento(deps, evento);

    expect(notificacoes).toHaveLength(1);
  });

  it('usa o status consultado no gateway, não o que a notificação diz', async () => {
    const pedido = await criarPedidoConfirmado(ordersRepo);
    await criarGeradorCobranca(deps).gerarCobranca(pedido);
    const pagamento = await paymentsRepo.buscarPorPedidoId(pedido.id);

    await processarNotificacaoPagamento(deps, { eventoId: 'evt-falso', idTransacaoExterno: pagamento!.idTransacaoExterno });

    expect((await ordersRepo.buscarPorId(pedido.id))?.status).toBe('AGUARDANDO_PAGAMENTO');
    expect(notificacoes).toHaveLength(0);
  });

  it('lança DomainError quando a transação não existe', async () => {
    await expect(
      processarNotificacaoPagamento(deps, { eventoId: 'evt-x', idTransacaoExterno: 'nao-existe' }),
    ).rejects.toThrow('não encontrado');
  });
});

describe('pollarPagamentosPendentes', () => {
  it('confirma pagamentos que mudaram de status desde a última checagem', async () => {
    const gatewayPix = criarMercadoPagoClientFake();
    const paymentsRepo = criarPaymentsRepositoryFake();
    const ordersRepo = criarOrdersRepositoryFake();
    const notificacoes: Pedido[] = [];

    const pedido = await criarPedidoConfirmado(ordersRepo);
    const gerador = criarGeradorCobranca({ gatewayPix, paymentsRepo });
    await gerador.gerarCobranca(pedido);
    const pagamento = await paymentsRepo.buscarPorPedidoId(pedido.id);

    gatewayPix.definirStatusConsulta(pagamento!.idTransacaoExterno, 'processed');

    await pollarPagamentosPendentes(
      { gatewayPix, paymentsRepo, ordersRepo, notificarEmpreendedor: async (p) => void notificacoes.push(p) },
      new Date(Date.now() + 60_000),
    );

    const pedidoAtualizado = await ordersRepo.buscarPorId(pedido.id);
    expect(pedidoAtualizado?.status).toBe('PAGO');
    expect(notificacoes).toHaveLength(1);
  });
});
