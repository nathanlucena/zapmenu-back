import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { MenuRepository } from '../menu/menu.repository.js';
import type { OrdersRepository } from '../orders/application/ports/orders.repository.js';
import type { PaymentsServiceDeps } from '../payments/application/dependencias.js';
import { criarCardapioDePrecos } from '../menu/cardapio-de-precos.js';
import { errorHandler } from './middlewares/error-handler.js';
import { registerRequestLogger } from './middlewares/request-logger.js';
import { registerMenuRoutes } from './v1/menu.routes.js';
import { registerOrdersRoutes } from './v1/orders.routes.js';
import { registerMercadoPagoWebhook } from './webhooks/mercado-pago.webhook.js';

export interface AppDeps {
  menuRepo: MenuRepository;
  ordersRepo: OrdersRepository;
  pedidoTtlMinutos: number;
  frontendAllowedOrigin: string;
  paymentsDeps?: PaymentsServiceDeps;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify();

  app.register(cors, { origin: deps.frontendAllowedOrigin });
  registerRequestLogger(app);
  app.setErrorHandler(errorHandler);

  app.register(
    async (v1) => {
      registerMenuRoutes(v1, deps.menuRepo);
      registerOrdersRoutes(v1, {
        ordersRepo: deps.ordersRepo,
        cardapioDePrecos: criarCardapioDePrecos(deps.menuRepo),
        pedidoTtlMinutos: deps.pedidoTtlMinutos,
      });
      if (deps.paymentsDeps) {
        registerMercadoPagoWebhook(v1, deps.paymentsDeps);
      }
    },
    { prefix: '/v1' },
  );

  return app;
}
