import { DomainError } from '../../shared/errors/domain-error.js';
import { podeTransicionar, ROTULO_STATUS_PEDIDO, type Pedido } from '../domain/pedido.js';
import type { OrdersRepository } from './ports/orders.repository.js';

export async function confirmarPagamento(
  repositorio: OrdersRepository,
  pedidoId: string,
  pedidoAtual: Pick<Pedido, 'status'>,
  agora: Date = new Date(),
): Promise<Pedido> {
  if (!podeTransicionar(pedidoAtual.status, 'PAGO')) {
    throw new DomainError(
      `Pedido não pode ser marcado como pago: está "${ROTULO_STATUS_PEDIDO[pedidoAtual.status]}".`,
      'TRANSICAO_INVALIDA',
      'CONFLITO',
    );
  }

  return repositorio.atualizar(pedidoId, { status: 'PAGO', confirmadoEm: agora });
}
