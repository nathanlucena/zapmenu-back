import type { OrdersRepository } from './orders.repository.js';
import { expirarPedidosPendentes } from './orders.service.js';
import { logger } from '../shared/logger/logger.js';

export async function executarCicloExpiracao(ordersRepo: OrdersRepository): Promise<void> {
  const expirados = await expirarPedidosPendentes(ordersRepo);
  if (expirados.length > 0) {
    logger.info({ quantidade: expirados.length }, 'pedidos expirados por TTL');
  }
}

export function iniciarJobExpiracaoPedidos(ordersRepo: OrdersRepository, intervaloMs: number): NodeJS.Timeout {
  return setInterval(() => {
    executarCicloExpiracao(ordersRepo).catch((erro: unknown) => {
      logger.error({ err: erro }, 'falha ao expirar pedidos pendentes');
    });
  }, intervaloMs);
}
