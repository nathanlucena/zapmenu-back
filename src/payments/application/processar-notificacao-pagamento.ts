import { DomainError } from '../../shared/errors/domain-error.js';
import { mapearStatusMercadoPago } from '../domain/pagamento.js';
import { aplicarStatusPagamento } from './aplicar-status-pagamento.js';
import type { PaymentsServiceDeps } from './dependencias.js';

const ORIGEM_IDEMPOTENCIA_WEBHOOK = 'mercado_pago_webhook';

export interface NotificacaoPagamento {
  eventoId: string;
  idTransacaoExterno: string;
}

/**
 * O status nunca vem da notificação: é sempre consultado no gateway, então
 * uma notificação falsa não consegue marcar um pedido como pago.
 */
export async function processarNotificacaoPagamento(
  deps: PaymentsServiceDeps,
  notificacao: NotificacaoPagamento,
  agora: Date = new Date(),
): Promise<void> {
  if (await deps.idempotency.jaProcessado(ORIGEM_IDEMPOTENCIA_WEBHOOK, notificacao.eventoId)) {
    return;
  }

  const pagamento = await deps.paymentsRepo.buscarPorIdTransacaoExterno(notificacao.idTransacaoExterno);
  if (!pagamento) {
    throw new DomainError(
      `Pagamento ${notificacao.idTransacaoExterno} não encontrado.`,
      'PAGAMENTO_NAO_ENCONTRADO',
      'NAO_ENCONTRADO',
    );
  }

  const consulta = await deps.gatewayPix.consultarPagamento(notificacao.idTransacaoExterno);
  await aplicarStatusPagamento(deps, pagamento, mapearStatusMercadoPago(consulta.statusMp), agora);
  await deps.idempotency.marcarProcessado(ORIGEM_IDEMPOTENCIA_WEBHOOK, notificacao.eventoId);
}
