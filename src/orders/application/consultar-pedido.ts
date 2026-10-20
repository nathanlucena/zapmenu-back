import { DomainError } from '../../shared/errors/domain-error.js';
import { extrairCodigoPedido, type ResumoPedidoPublico } from '../domain/pedido.js';
import type { OrdersRepository } from './ports/orders.repository.js';

/** Status de um pedido para o app do cliente, pelo código PED-XXXX. */
export async function consultarPedido(repositorio: OrdersRepository, codigo: string): Promise<ResumoPedidoPublico> {
  const codigoCurto = extrairCodigoPedido(codigo);
  const resumo = codigoCurto === codigo.trim().toUpperCase() ? await repositorio.buscarResumoPublico(codigoCurto) : null;
  if (!resumo) {
    throw new DomainError(`Pedido ${codigo} não encontrado.`, 'PEDIDO_NAO_ENCONTRADO', 'NAO_ENCONTRADO');
  }
  return resumo;
}
