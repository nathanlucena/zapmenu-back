import { getEnv } from './config/index.js';
import { buildApp } from './http/app.js';
import { criarConversationRepositoryPrisma } from './menu/conversation/conversation.repository.prisma.js';
import { criarGoogleGeocodingClient } from './menu/endereco/google-geocoding.client.js';
import { criarViaCepClient } from './menu/endereco/viacep.client.js';
import { criarInterpretadorDeepSeek } from './menu/gestao/deepseek-interpretador.js';
import { criarGestaoRepositoryPrisma } from './menu/gestao/gestao.repository.prisma.js';
import { criarMenuRepositoryPrisma } from './menu/menu.repository.prisma.js';
import { iniciarJobExpiracaoPedidos } from './orders/order-expiration.job.js';
import { criarOrdersRepositoryPrisma } from './orders/orders.repository.prisma.js';
import type { Pedido } from './orders/orders.types.js';
import { criarMercadoPagoClient } from './payments/mercado-pago.client.js';
import { iniciarJobPollingPagamentos } from './payments/payment-status-poller.job.js';
import { criarPaymentsRepositoryPrisma } from './payments/payments.repository.prisma.js';
import { criarGeradorCobranca, type PaymentsServiceDeps } from './payments/payments.service.js';
import { getPrismaClient } from './shared/db/prisma-client.js';
import { criarIdempotencyRepositoryPrisma } from './shared/idempotency/idempotency.repository.prisma.js';
import { logger } from './shared/logger/logger.js';
import type { WhatsAppClient } from './whatsapp/whatsapp-client.interface.js';
import { registrarMenuInboundRouter } from './whatsapp/menu-session/menu-inbound.router.js';
import { registrarOrdersInboundRouter } from './whatsapp/orders-session/orders-inbound.router.js';
import { iniciarSessaoWppConnect } from './whatsapp/wppconnect/session-manager.js';

async function main(): Promise<void> {
  const env = getEnv();
  const prisma = getPrismaClient();

  const menuRepo = criarMenuRepositoryPrisma(prisma);
  const ordersRepo = criarOrdersRepositoryPrisma(prisma);
  const paymentsRepo = criarPaymentsRepositoryPrisma(prisma);
  const conversationRepo = criarConversationRepositoryPrisma(prisma);
  const gestaoRepo = criarGestaoRepositoryPrisma(prisma);
  const idempotency = criarIdempotencyRepositoryPrisma(prisma);
  const mpClient = criarMercadoPagoClient(env.MERCADO_PAGO_ACCESS_TOKEN);

  const interpretador = env.DEEPSEEK_API_KEY
    ? criarInterpretadorDeepSeek({
        apiKey: env.DEEPSEEK_API_KEY,
        modelo: env.DEEPSEEK_MODEL,
        baseURL: env.DEEPSEEK_BASE_URL,
      })
    : undefined;
  if (interpretador) {
    logger.info({ modelo: env.DEEPSEEK_MODEL }, '🧠 IA de gestão: DeepSeek');
  } else {
    logger.warn('DEEPSEEK_API_KEY não definida: a gestão só vai entender palavras-chave');
  }

  const endereco = env.GOOGLE_MAPS_API_KEY
    ? { consultaCep: criarViaCepClient(), geocodificador: criarGoogleGeocodingClient(env.GOOGLE_MAPS_API_KEY) }
    : undefined;
  if (!endereco) {
    logger.warn('GOOGLE_MAPS_API_KEY não definida: o cadastro de endereço (entrega por distância) fica indisponível');
  }

  // A sessão de gestão é quem fala com os empreendedores, então é por ela que
  // o "novo pedido pago" é notificado — atualizada a cada (re)conexão da sessão.
  let menuWhatsAppClient: WhatsAppClient | undefined;

  async function notificarEmpreendedor(pedido: Pedido): Promise<void> {
    if (!menuWhatsAppClient) {
      logger.warn({ pedidoId: pedido.id }, 'sessão de gestão indisponível, não foi possível notificar empreendedor');
      return;
    }
    const empreendedor = await prisma.empreendedor.findUnique({ where: { id: pedido.empreendedorId } });
    if (!empreendedor) {
      logger.warn({ pedidoId: pedido.id }, 'empreendedor não encontrado para notificação de pedido pago');
      return;
    }
    await menuWhatsAppClient.sendText(
      empreendedor.telefone,
      `Novo pedido pago! ${pedido.codigoCurto} — R$ ${pedido.valorTotal.toFixed(2)}`,
    );
  }

  const paymentsDeps: PaymentsServiceDeps = {
    mpClient,
    paymentsRepo,
    ordersRepo,
    idempotency,
    notificarEmpreendedor,
  };

  if (env.WPP_SESSOES.includes('menu')) {
    await iniciarSessaoWppConnect(
      {
        sessionName: env.WPP_MENU_SESSION_NAME,
        tokenStorePath: env.WPP_MENU_TOKEN_STORE_PATH,
        headless: env.WPP_HEADLESS,
        chromiumExecutablePath: env.WPP_CHROMIUM_EXECUTABLE_PATH,
        modoAutoteste: env.WPP_MODO_AUTOTESTE,
        logLevelWppConnect: env.WPP_LOG_LEVEL,
        numerosPermitidos: env.WPP_NUMEROS_PERMITIDOS,
      },
      (client) => {
        menuWhatsAppClient = client;
        registrarMenuInboundRouter({
          whatsapp: client,
          conversationRepo,
          gestaoRepo,
          idempotency,
          interpretador,
          endereco,
          resolverEmpreendedorId: async (telefone) => telefone,
        });
      },
    );
  }

  if (env.WPP_SESSOES.includes('orders')) {
    await iniciarSessaoWppConnect(
      {
        sessionName: env.WPP_ORDERS_SESSION_NAME,
        tokenStorePath: env.WPP_ORDERS_TOKEN_STORE_PATH,
        headless: env.WPP_HEADLESS,
        chromiumExecutablePath: env.WPP_CHROMIUM_EXECUTABLE_PATH,
        modoAutoteste: env.WPP_MODO_AUTOTESTE,
        logLevelWppConnect: env.WPP_LOG_LEVEL,
        numerosPermitidos: env.WPP_NUMEROS_PERMITIDOS,
      },
      (client) => {
        registrarOrdersInboundRouter({
          whatsapp: client,
          ordersRepo,
          idempotency,
          geradorCobranca: criarGeradorCobranca(paymentsDeps),
        });
      },
    );
  }

  iniciarJobExpiracaoPedidos(ordersRepo, env.PEDIDO_TTL_MINUTOS * 60_000);
  iniciarJobPollingPagamentos(
    paymentsDeps,
    env.PAGAMENTO_POLLING_INTERVALO_SEGUNDOS * 1000,
    env.PAGAMENTO_POLLING_INTERVALO_SEGUNDOS,
  );

  const app = buildApp({
    menuRepo,
    ordersRepo,
    pedidoTtlMinutos: env.PEDIDO_TTL_MINUTOS,
    frontendAllowedOrigin: env.FRONTEND_ALLOWED_ORIGIN,
    paymentsDeps,
  });

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT }, 'servidor no ar');
}

main().catch((erro) => {
  logger.error({ err: erro }, 'falha fatal ao iniciar a aplicação');
  process.exit(1);
});
