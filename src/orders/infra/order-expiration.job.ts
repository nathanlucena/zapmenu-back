import type { OrdersRepository } from '../application/ports/orders.repository.js';
import { concluirPedidosAntigos } from '../application/andamento-pedido.js';
import { expirarPedidosPendentes } from '../application/expirar-pedidos-pendentes.js';
import { logger } from '../../shared/logger/logger.js';

/** Expira os pedidos sem resposta e conclui os que ficaram em andamento por mais de `horasConclusao`. */
export async function executarCicloExpiracao(ordersRepo: OrdersRepository, horasConclusao?: number): Promise<void> {
  const expirados = await expirarPedidosPendentes(ordersRepo);
  if (expirados.length > 0) {
    logger.info({ quantidade: expirados.length }, 'pedidos expirados por TTL');
  }
  if (horasConclusao !== undefined) {
    const concluidos = await concluirPedidosAntigos(ordersRepo, horasConclusao);
    if (concluidos.length > 0) {
      logger.info({ quantidade: concluidos.length }, 'pedidos concluídos automaticamente');
    }
  }
}

export function iniciarJobExpiracaoPedidos(
  ordersRepo: OrdersRepository,
  intervaloMs: number,
  horasConclusao?: number,
): NodeJS.Timeout {
  return setInterval(() => {
    executarCicloExpiracao(ordersRepo, horasConclusao).catch((erro: unknown) => {
      logger.error({ err: erro }, 'falha ao expirar pedidos pendentes');
    });
  }, intervaloMs);
}
