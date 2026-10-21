import type { OrdersRepository } from '../../orders/application/ports/orders.repository.js';
import type { PaymentsRepository } from '../../payments/application/ports/payments.repository.js';
import type { GeradorCobranca } from '../../payments/application/gerar-cobranca.js';
import { logger } from '../../shared/logger/logger.js';
import type { WhatsAppClient } from '../whatsapp-client.interface.js';
import { enviarPix } from './orders-inbound.router.js';

export interface PixPendenteDeps {
  ordersRepo: OrdersRepository;
  paymentsRepo: PaymentsRepository;
  geradorCobranca: GeradorCobranca;
  /** Sessão que fala com os clientes; sem ela, espera o próximo ciclo. */
  cliente: () => WhatsAppClient | undefined;
}

/**
 * Pedidos aceitos que ainda não têm cobrança (o PIX falhou no aceite): tenta
 * gerar de novo e manda ao cliente. Devolve quantos PIX saíram.
 */
export async function reenviarPixPendentes(deps: PixPendenteDeps): Promise<number> {
  const cliente = deps.cliente();
  if (!cliente) {
    return 0;
  }
  let enviados = 0;
  for (const pedido of await deps.ordersRepo.listarPorStatus('AGUARDANDO_PAGAMENTO')) {
    if (!pedido.telefoneCliente || (await deps.paymentsRepo.buscarPorPedidoId(pedido.id))) {
      continue;
    }
    try {
      await deps.geradorCobranca.gerarCobranca(pedido);
      await cliente.sendText(pedido.telefoneCliente, `Pronto! Aqui está o PIX do pedido ${pedido.codigoCurto}:`);
      await enviarPix(cliente, deps.geradorCobranca, pedido, pedido.telefoneCliente);
      enviados++;
      logger.info({ codigoCurto: pedido.codigoCurto }, '🔁 PIX que tinha falhado no aceite foi gerado e enviado');
    } catch (erro) {
      logger.warn({ err: erro, codigoCurto: pedido.codigoCurto }, 'PIX ainda não saiu; tenta no próximo ciclo');
    }
  }
  return enviados;
}
