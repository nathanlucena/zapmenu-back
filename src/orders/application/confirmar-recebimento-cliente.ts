import { DomainError } from '../../shared/errors/domain-error.js';
import { estaExpirado, podeTransicionar, type Pedido } from '../domain/pedido.js';
import type { OrdersRepository } from './ports/orders.repository.js';

export async function confirmarRecebimentoCliente(
  repositorio: OrdersRepository,
  codigoCurto: string,
  telefoneCliente: string,
  agora: Date = new Date(),
): Promise<Pedido> {
  const pedido = await repositorio.buscarPorCodigo(codigoCurto);
  if (!pedido) {
    throw new DomainError(`Pedido ${codigoCurto} não encontrado.`, 'PEDIDO_NAO_ENCONTRADO', 'NAO_ENCONTRADO');
  }
  if (estaExpirado(pedido, agora)) {
    throw new DomainError(`Pedido ${codigoCurto} expirou.`, 'PEDIDO_EXPIRADO', 'CONFLITO');
  }
  if (!podeTransicionar(pedido.status, 'AGUARDANDO_PAGAMENTO')) {
    throw new DomainError(
      `Pedido ${codigoCurto} está em status ${pedido.status} e não pode ser confirmado.`,
      'TRANSICAO_INVALIDA',
      'CONFLITO',
    );
  }

  return repositorio.atualizar(pedido.id, {
    status: 'AGUARDANDO_PAGAMENTO',
    telefoneCliente,
  });
}
