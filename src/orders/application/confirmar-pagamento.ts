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

  // TODO(varejo): dar baixa no estoque dos SKUs do pedido aqui (PIX aprovado), na
  // mesma transação da mudança para PAGO e sem deixar o estoque negativo. Ver
  // também o CONFIRMADO em decidir-pedido.ts (pagamento na entrega).
  return repositorio.atualizar(pedidoId, { status: 'PAGO', confirmadoEm: agora });
}
