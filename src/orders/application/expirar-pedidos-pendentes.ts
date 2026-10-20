import { estaExpirado, podeTransicionar, type Pedido } from '../domain/pedido.js';
import type { OrdersRepository } from './ports/orders.repository.js';

export async function expirarPedidosPendentes(
  repositorio: OrdersRepository,
  agora: Date = new Date(),
): Promise<Pedido[]> {
  const pendentes = await repositorio.listarExpirados(agora);
  const expirados: Pedido[] = [];

  for (const pedido of pendentes) {
    if (estaExpirado(pedido, agora) && podeTransicionar(pedido.status, 'EXPIRADO')) {
      expirados.push(await repositorio.atualizar(pedido.id, { status: 'EXPIRADO' }));
    }
  }

  return expirados;
}
