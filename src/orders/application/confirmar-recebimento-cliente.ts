import { DomainError } from '../../shared/errors/domain-error.js';
import { estaExpirado, podeTransicionar, type Pedido, type StatusPedido } from '../domain/pedido.js';
import type { OrdersRepository } from './ports/orders.repository.js';

/** Resposta ao cliente que manda o código de um pedido que não pode mais ser confirmado. */
function motivoSemConfirmacao(codigoCurto: string, status: StatusPedido): string {
  switch (status) {
    case 'PAGO':
      return `O pedido ${codigoCurto} já foi pago ✅`;
    case 'CANCELADO':
      return `O pedido ${codigoCurto} foi cancelado pela loja.`;
    default:
      return `O pedido ${codigoCurto} expirou. Faça um novo pedido pelo cardápio.`;
  }
}

/**
 * Liga o pedido ao telefone do cliente e o deixa aguardando pagamento. Se ele
 * já está aguardando pagamento (o cliente mandou o código de novo), devolve o
 * pedido sem mudança para o PIX ser reenviado.
 */
export async function confirmarRecebimentoCliente(
  repositorio: OrdersRepository,
  codigoCurto: string,
  telefoneCliente: string,
  agora: Date = new Date(),
): Promise<Pedido> {
  const pedido = await repositorio.buscarPorCodigo(codigoCurto);
  if (!pedido) {
    throw new DomainError(
      `Não encontrei o pedido ${codigoCurto}. Confira o código ou faça um novo pedido pelo cardápio.`,
      'PEDIDO_NAO_ENCONTRADO',
      'NAO_ENCONTRADO',
    );
  }
  if (pedido.status === 'AGUARDANDO_PAGAMENTO') {
    return pedido;
  }
  if (estaExpirado(pedido, agora)) {
    throw new DomainError(motivoSemConfirmacao(codigoCurto, 'EXPIRADO'), 'PEDIDO_EXPIRADO', 'CONFLITO');
  }
  if (!podeTransicionar(pedido.status, 'AGUARDANDO_PAGAMENTO')) {
    throw new DomainError(motivoSemConfirmacao(codigoCurto, pedido.status), 'TRANSICAO_INVALIDA', 'CONFLITO');
  }

  return repositorio.atualizar(pedido.id, {
    status: 'AGUARDANDO_PAGAMENTO',
    telefoneCliente,
  });
}
