import type { OrdersRepository } from '../../orders/application/ports/orders.repository.js';
import type { Pedido } from '../../orders/domain/pedido.js';
import type { IdempotencyRepository } from '../../shared/idempotency/idempotency.repository.js';
import type { GatewayPix } from './ports/gateway-pix.js';
import type { PaymentsRepository } from './ports/payments.repository.js';

export interface PaymentsServiceDeps {
  gatewayPix: GatewayPix;
  paymentsRepo: PaymentsRepository;
  ordersRepo: OrdersRepository;
  idempotency: IdempotencyRepository;
  notificarEmpreendedor: (pedido: Pedido) => Promise<void>;
  /** Avisa o cliente que o pagamento entrou e a loja está preparando. Opcional: sem a sessão de pedidos, só a loja é avisada. */
  avisarCliente?: (pedido: Pedido) => Promise<void>;
}
