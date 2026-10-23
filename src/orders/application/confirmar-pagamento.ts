import { DomainError } from '../../shared/errors/domain-error.js';
import { podeTransicionar, ROTULO_STATUS_PEDIDO, type Pedido } from '../domain/pedido.js';
import type { OrdersRepository } from './ports/orders.repository.js';

/**
 * PIX aprovado: marca como pago e dá baixa no estoque dos SKUs na mesma
 * transação. Faltando estoque (duas compras disputaram as últimas peças), o
 * pedido fica pago assim mesmo, porque o dinheiro já entrou, e a falta vai no
 * aviso à loja. Devolve null se outra notificação do mesmo pagamento chegou
 * antes: nada é baixado nem avisado de novo.
 */
export async function confirmarPagamento(
  repositorio: OrdersRepository,
  pedidoId: string,
  pedidoAtual: Pick<Pedido, 'status'>,
  agora: Date = new Date(),
): Promise<Pedido | null> {
  if (!podeTransicionar(pedidoAtual.status, 'PAGO')) {
    throw new DomainError(
      `Pedido não pode ser marcado como pago: está "${ROTULO_STATUS_PEDIDO[pedidoAtual.status]}".`,
      'TRANSICAO_INVALIDA',
      'CONFLITO',
    );
  }

  const resultado = await repositorio.registrarVenda(pedidoId, {
    de: pedidoAtual.status,
    para: 'PAGO',
    confirmadoEm: agora,
    seFaltarEstoque: 'VENDER_ASSIM_MESMO',
  });
  return resultado.tipo === 'REGISTRADA' ? resultado.pedido : null;
}
