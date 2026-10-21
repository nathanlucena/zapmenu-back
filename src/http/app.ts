import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { MenuRepository } from '../menu/menu.repository.js';
import type { OrdersRepository } from '../orders/application/ports/orders.repository.js';
import type { PaymentsServiceDeps } from '../payments/application/dependencias.js';
import { criarCardapioDePrecos } from '../menu/cardapio-de-precos.js';
import { criarLocalizadorEntrega } from '../menu/endereco/localizador-entrega.js';
import type { EnderecoDeps } from '../menu/endereco/endereco.types.js';
import { criarLojaParaPedidos } from '../menu/loja-para-pedidos.js';
import { errorHandler, rotaNaoEncontrada } from './middlewares/error-handler.js';
import { configurarMensagensDeValidacao } from './validacao/mensagens-zod.js';
import { registerRequestLogger } from './middlewares/request-logger.js';
import { registerMenuRoutes } from './v1/menu.routes.js';
import { registerOrdersRoutes } from './v1/orders.routes.js';
import { registerPreviasRoutes } from './v1/previas.routes.js';
import type { PreviasRepository } from '../menu/gestao/previa.js';
import { registerMercadoPagoWebhook } from './webhooks/mercado-pago.webhook.js';

export interface AppDeps {
  menuRepo: MenuRepository;
  ordersRepo: OrdersRepository;
  pedidoTtlMinutos: number;
  frontendAllowedOrigin: string;
  /** Número da sessão de pedidos, devolvido no cardápio para o link wa.me. */
  whatsappPedidos?: string;
  /** ViaCEP + Google. Sem isso, os pedidos só podem ser de retirada. */
  endereco?: EnderecoDeps;
  paymentsDeps?: PaymentsServiceDeps;
  /** Obrigatório junto com paymentsDeps: o webhook só aceita notificações assinadas. */
  mercadoPagoWebhookSecret?: string;
  /** Prévias em imagem da gestão (o front busca os dados e desenha). */
  previas?: PreviasRepository;
}

configurarMensagensDeValidacao();

export function buildApp(deps: AppDeps): FastifyInstance {
  // Id curto em cada requisição: vai no log e no corpo dos 500 ("rastreio"), para achar o erro.
  const app = Fastify({ genReqId: () => randomUUID().slice(0, 8) });

  app.register(cors, { origin: deps.frontendAllowedOrigin });
  registerRequestLogger(app);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(rotaNaoEncontrada);

  app.register(
    async (v1) => {
      registerMenuRoutes(v1, deps.menuRepo, deps.whatsappPedidos);
      registerOrdersRoutes(v1, {
        ordersRepo: deps.ordersRepo,
        cardapioDePrecos: criarCardapioDePrecos(deps.menuRepo),
        lojaParaPedidos: criarLojaParaPedidos(deps.menuRepo),
        localizador: deps.endereco && criarLocalizadorEntrega(deps.endereco),
        pedidoTtlMinutos: deps.pedidoTtlMinutos,
      });
      if (deps.previas) {
        registerPreviasRoutes(v1, deps.previas);
      }
      if (deps.paymentsDeps) {
        if (!deps.mercadoPagoWebhookSecret) {
          throw new Error('mercadoPagoWebhookSecret é obrigatório para registrar o webhook do Mercado Pago.');
        }
        registerMercadoPagoWebhook(v1, deps.paymentsDeps, { segredo: deps.mercadoPagoWebhookSecret });
      }
    },
    { prefix: '/v1' },
  );

  return app;
}
