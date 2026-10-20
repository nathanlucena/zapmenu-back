import { DomainError } from '../shared/errors/domain-error.js';
import type { IdempotencyRepository } from '../shared/idempotency/idempotency.repository.js';
import { confirmarPagamento } from '../orders/orders.service.js';
import type { OrdersRepository } from '../orders/orders.repository.js';
import type { Pedido } from '../orders/orders.types.js';
import type { CobrancaGerada, GeradorCobranca } from '../whatsapp/orders-session/orders-inbound.router.js';
import type { MercadoPagoClient } from './mercado-pago.client.js';
import type { PaymentsRepository } from './payments.repository.js';
import type { Pagamento, StatusPagamento } from './payments.types.js';

const ORIGEM_IDEMPOTENCIA_WEBHOOK = 'mercado_pago_webhook';

const MAPA_STATUS_MP: Record<string, StatusPagamento> = {
  approved: 'APROVADO',
  rejected: 'REJEITADO',
  cancelled: 'REJEITADO',
  refunded: 'REJEITADO',
  charged_back: 'REJEITADO',
  pending: 'PENDENTE',
  in_process: 'PENDENTE',
};

export function mapearStatusMercadoPago(statusMp: string): StatusPagamento {
  return MAPA_STATUS_MP[statusMp] ?? 'PENDENTE';
}

export interface PaymentsServiceDeps {
  mpClient: MercadoPagoClient;
  paymentsRepo: PaymentsRepository;
  ordersRepo: OrdersRepository;
  idempotency: IdempotencyRepository;
  notificarEmpreendedor: (pedido: Pedido) => Promise<void>;
}

export function criarGeradorCobranca(deps: Pick<PaymentsServiceDeps, 'mpClient' | 'paymentsRepo'>): GeradorCobranca {
  return {
    async gerarCobranca(pedido: Pedido): Promise<CobrancaGerada> {
      const existente = await deps.paymentsRepo.buscarPorPedidoId(pedido.id);
      if (existente) {
        return { copiaCola: existente.copiaCola ?? '', qrCodeBase64: existente.qrCodeBase64 };
      }

      const cobranca = await deps.mpClient.criarCobrancaPix({
        valor: pedido.valorTotal,
        descricao: `Pedido ${pedido.codigoCurto}`,
        referenciaExterna: pedido.id,
      });

      await deps.paymentsRepo.criar({
        pedidoId: pedido.id,
        provedor: 'mercado_pago',
        idTransacaoExterno: cobranca.idTransacaoExterno,
        status: mapearStatusMercadoPago(cobranca.statusMp),
        copiaCola: cobranca.copiaCola,
        qrCodeBase64: cobranca.qrCodeBase64,
        criadoEm: new Date(),
      });

      return { copiaCola: cobranca.copiaCola ?? '', qrCodeBase64: cobranca.qrCodeBase64 };
    },
  };
}

async function aplicarNovoStatus(
  deps: Pick<PaymentsServiceDeps, 'paymentsRepo' | 'ordersRepo' | 'notificarEmpreendedor'>,
  pagamento: Pagamento,
  novoStatus: StatusPagamento,
  agora: Date,
): Promise<void> {
  if (pagamento.status === novoStatus) {
    return;
  }

  await deps.paymentsRepo.atualizarStatus(pagamento.id, novoStatus, novoStatus === 'APROVADO' ? agora : undefined);

  if (novoStatus !== 'APROVADO') {
    return;
  }

  const pedido = await deps.ordersRepo.buscarPorId(pagamento.pedidoId);
  if (!pedido) {
    throw new DomainError(`Pedido ${pagamento.pedidoId} não encontrado para pagamento aprovado.`, 'PEDIDO_NAO_ENCONTRADO');
  }

  const pedidoPago = await confirmarPagamento(deps.ordersRepo, pedido.id, pedido, agora);
  await deps.notificarEmpreendedor(pedidoPago);
}

export async function processarWebhookPagamento(
  deps: PaymentsServiceDeps,
  evento: { eventoId: string; idTransacaoExterno: string; statusMp: string },
  agora: Date = new Date(),
): Promise<void> {
  if (await deps.idempotency.jaProcessado(ORIGEM_IDEMPOTENCIA_WEBHOOK, evento.eventoId)) {
    return;
  }

  const pagamento = await deps.paymentsRepo.buscarPorIdTransacaoExterno(evento.idTransacaoExterno);
  if (!pagamento) {
    throw new DomainError(`Pagamento ${evento.idTransacaoExterno} não encontrado.`, 'PAGAMENTO_NAO_ENCONTRADO');
  }

  await aplicarNovoStatus(deps, pagamento, mapearStatusMercadoPago(evento.statusMp), agora);
  await deps.idempotency.marcarProcessado(ORIGEM_IDEMPOTENCIA_WEBHOOK, evento.eventoId);
}

export async function pollarPagamentosPendentes(
  deps: Pick<PaymentsServiceDeps, 'mpClient' | 'paymentsRepo' | 'ordersRepo' | 'notificarEmpreendedor'>,
  limiteIdade: Date,
  agora: Date = new Date(),
): Promise<void> {
  const pendentes = await deps.paymentsRepo.listarPendentesAntesDe(limiteIdade);

  for (const pagamento of pendentes) {
    const consulta = await deps.mpClient.consultarPagamento(pagamento.idTransacaoExterno);
    await aplicarNovoStatus(deps, pagamento, mapearStatusMercadoPago(consulta.statusMp), agora);
  }
}
