import { confirmarPagamento } from '../../orders/application/confirmar-pagamento.js';
import { DomainError } from '../../shared/errors/domain-error.js';
import type { Pagamento, StatusPagamento } from '../domain/pagamento.js';
import type { PaymentsServiceDeps } from './dependencias.js';

/** Grava o novo status e, se aprovado, marca o pedido como pago e avisa a loja. */
export async function aplicarStatusPagamento(
  deps: Pick<PaymentsServiceDeps, 'paymentsRepo' | 'ordersRepo' | 'notificarEmpreendedor' | 'avisarCliente'>,
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
    throw new DomainError(
      `Pedido ${pagamento.pedidoId} não encontrado para pagamento aprovado.`,
      'PEDIDO_NAO_ENCONTRADO',
      'NAO_ENCONTRADO',
    );
  }

  const pedidoPago = await confirmarPagamento(deps.ordersRepo, pedido.id, pedido, agora);
  await deps.notificarEmpreendedor(pedidoPago);
  await deps.avisarCliente?.(pedidoPago);
}
