import { getEnv } from './config/index.js';
import { buildApp } from './http/app.js';
import { criarConversationRepositoryPrisma } from './menu/conversation/conversation.repository.prisma.js';
import { criarGoogleGeocodingClient } from './menu/endereco/google-geocoding.client.js';
import { criarViaCepClient } from './menu/endereco/viacep.client.js';
import { criarCadastroPorLista } from './menu/gestao/cadastro-empreendedores.js';
import { criarInterpretadorDeepSeek } from './menu/gestao/deepseek-interpretador.js';
import { criarGestaoRepositoryPrisma } from './menu/gestao/gestao.repository.prisma.js';
import { criarMenuRepositoryPrisma } from './menu/menu.repository.prisma.js';
import { avisarPedidoPago } from './orders/application/avisar-pedido-pago.js';
import { criarContatoEmpreendedoresPrisma } from './orders/infra/contato-empreendedores.prisma.js';
import { iniciarJobExpiracaoPedidos } from './orders/infra/order-expiration.job.js';
import { criarOrdersRepositoryPrisma } from './orders/infra/orders.repository.prisma.js';
import type { Pedido } from './orders/domain/pedido.js';
import { criarMercadoPagoClient } from './payments/infra/mercado-pago.client.js';
import { iniciarJobPollingPagamentos } from './payments/infra/payment-status-poller.job.js';
import { criarPaymentsRepositoryPrisma } from './payments/infra/payments.repository.prisma.js';
import { criarGeradorCobranca } from './payments/application/gerar-cobranca.js';
import { comPagamentoSimulado } from './payments/infra/pagamento-simulado.js';
import { pedirAceiteDaLoja } from './orders/application/pedir-aceite-da-loja.js';
import { mensagemPagamentoConfirmado } from './orders/application/avisos-cliente.js';
import { pedirAndamentoDaLoja } from './orders/application/andamento-pedido.js';
import { criarEnquetesRepositoryPrisma } from './whatsapp/baileys/enquetes.repository.prisma.js';
import type { PaymentsServiceDeps } from './payments/application/dependencias.js';
import { getPrismaClient } from './shared/db/prisma-client.js';
import { criarIdempotencyRepositoryPrisma } from './shared/idempotency/idempotency.repository.prisma.js';
import { logger } from './shared/logger/logger.js';
import type { WhatsAppClient } from './whatsapp/whatsapp-client.interface.js';
import { registrarMenuInboundRouter } from './whatsapp/menu-session/menu-inbound.router.js';
import { registrarOrdersInboundRouter } from './whatsapp/orders-session/orders-inbound.router.js';
import { iniciarSessaoWhatsApp } from './whatsapp/baileys/session-manager.js';
import { dividirMensagens } from './whatsapp/numero-unico/dividir-mensagens.js';
import { identificarBot, ROTULO_GESTAO, ROTULO_PEDIDOS } from './whatsapp/identificacao/identificar-bot.js';
import { chaveTelefone } from './shared/telefone/telefone.js';

async function main(): Promise<void> {
  const env = getEnv();
  const prisma = getPrismaClient(env.DATABASE_URL);

  const menuRepo = criarMenuRepositoryPrisma(prisma);
  const ordersRepo = criarOrdersRepositoryPrisma(prisma);
  const paymentsRepo = criarPaymentsRepositoryPrisma(prisma);
  const conversationRepo = criarConversationRepositoryPrisma(prisma);
  const gestaoRepo = criarGestaoRepositoryPrisma(prisma);
  const idempotency = criarIdempotencyRepositoryPrisma(prisma);
  const gatewayPix = criarMercadoPagoClient(env.MERCADO_PAGO_ACCESS_TOKEN, fetch, {
    pagadorTeste: env.MERCADO_PAGO_PAGADOR_TESTE,
  });

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

  const cadastroEmpreendedores = criarCadastroPorLista(env.GESTAO_TELEFONES_PERMITIDOS);
  if (env.GESTAO_TELEFONES_PERMITIDOS.length === 0) {
    logger.warn('GESTAO_TELEFONES_PERMITIDOS vazia: qualquer número pode usar a gestão do cardápio');
  }

  // A sessão de gestão é quem fala com os empreendedores, então é por ela que
  // o "novo pedido pago" é notificado — atualizada a cada (re)conexão da sessão.
  let menuWhatsAppClient: WhatsAppClient | undefined;
  // Quem fala com os clientes: usado quando a loja aceita ou recusa pela gestão.
  let pedidosWhatsAppClient: WhatsAppClient | undefined;

  const contatos = criarContatoEmpreendedoresPrisma(prisma);
  const mensageiroLoja = {
    async enviarTexto(telefone: string, texto: string) {
      if (!menuWhatsAppClient) {
        logger.warn('sessão de gestão indisponível, não foi possível notificar empreendedor');
        return;
      }
      await menuWhatsAppClient.sendText(telefone, texto);
    },
    async enviarEnquete(telefone: string, pergunta: string, opcoes: string[]) {
      return menuWhatsAppClient?.sendPoll(telefone, pergunta, opcoes);
    },
  };
  const avisoPedidoPago = { contatos, mensageiro: mensageiroLoja };
  // Pago: a loja recebe os dados completos e a enquete de andamento (saiu/pronto, entregue/retirado).
  const notificarEmpreendedor = async (pedido: Pedido) => {
    await avisarPedidoPago(avisoPedidoPago, pedido);
    await pedirAndamentoDaLoja({ ordersRepo, contatos, mensageiro: mensageiroLoja }, pedido);
  };
  const avisarCliente = async (pedido: Pedido) => {
    if (!pedidosWhatsAppClient || !pedido.telefoneCliente) {
      logger.warn({ codigoCurto: pedido.codigoCurto }, 'sessão de pedidos indisponível, cliente não foi avisado do pagamento');
      return;
    }
    await pedidosWhatsAppClient.sendText(pedido.telefoneCliente, mensagemPagamentoConfirmado(pedido));
  };

  const paymentsDeps: PaymentsServiceDeps = {
    gatewayPix,
    paymentsRepo,
    ordersRepo,
    idempotency,
    notificarEmpreendedor,
    avisarCliente,
  };

  const geradorCobranca = comPagamentoSimulado(criarGeradorCobranca(paymentsDeps), paymentsDeps, {
    modoAutoteste: env.WPP_MODO_AUTOTESTE,
    segundos: env.PAGAMENTO_SIMULADO_SEGUNDOS,
  });
  const enquetes = criarEnquetesRepositoryPrisma(prisma);

  // No autoteste cada mensagem diz qual bot está falando (gestão ou pedidos).
  const comRotulo = (client: WhatsAppClient, rotulo: string) =>
    env.WPP_MODO_AUTOTESTE ? identificarBot(client, rotulo) : client;

  const registrarGestao = (conexao: WhatsAppClient) => {
    const client = comRotulo(conexao, ROTULO_GESTAO);
    menuWhatsAppClient = client;
    registrarMenuInboundRouter({
      whatsapp: client,
      conversationRepo,
      gestaoRepo,
      idempotency,
      interpretador,
      endereco,
      cadastro: cadastroEmpreendedores,
      decisoes: { ordersRepo, contatos, geradorCobranca, clientePedidos: () => pedidosWhatsAppClient },
    });
  };
  const registrarPedidos = (conexao: WhatsAppClient) => {
    const client = comRotulo(conexao, ROTULO_PEDIDOS);
    pedidosWhatsAppClient = client;
    registrarOrdersInboundRouter({
      whatsapp: client,
      ordersRepo,
      idempotency,
      geradorCobranca,
      pedirAceite: (pedido) => pedirAceiteDaLoja({ ordersRepo, contatos, mensageiro: mensageiroLoja }, pedido),
      prazoAceiteMs: env.PEDIDO_ACEITE_MINUTOS * 60_000,
    });
  };
  const sessao = (sessionName: string, tokenStorePath: string) => ({
    sessionName,
    tokenStorePath,
    modoAutoteste: env.WPP_MODO_AUTOTESTE,
    logLevelBaileys: env.WPP_LOG_LEVEL,
    numerosPermitidos: env.WPP_NUMEROS_PERMITIDOS,
    enquetes,
  });

  const numeroUnico =
    env.WPP_SESSOES.includes('menu') &&
    env.WPP_SESSOES.includes('orders') &&
    chaveTelefone(env.WPP_MENU_PHONE_NUMBER) === chaveTelefone(env.WPP_ORDERS_PHONE_NUMBER);

  if (numeroUnico) {
    logger.warn(
      'gestão e pedidos usam o mesmo número: uma sessão só, mensagens com PED-XXXX vão para pedidos e as outras para a gestão',
    );
    await iniciarSessaoWhatsApp(sessao(env.WPP_MENU_SESSION_NAME, env.WPP_MENU_TOKEN_STORE_PATH), (client) => {
      const { gestao, pedidos } = dividirMensagens(client);
      registrarGestao(gestao);
      registrarPedidos(pedidos);
    });
  } else {
    if (env.WPP_SESSOES.includes('menu')) {
      await iniciarSessaoWhatsApp(sessao(env.WPP_MENU_SESSION_NAME, env.WPP_MENU_TOKEN_STORE_PATH), registrarGestao);
    }
    if (env.WPP_SESSOES.includes('orders')) {
      await iniciarSessaoWhatsApp(sessao(env.WPP_ORDERS_SESSION_NAME, env.WPP_ORDERS_TOKEN_STORE_PATH), registrarPedidos);
    }
  }

  iniciarJobExpiracaoPedidos(ordersRepo, env.PEDIDO_TTL_MINUTOS * 60_000, env.PEDIDO_CONCLUSAO_HORAS);
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
    endereco,
    whatsappPedidos: env.WPP_ORDERS_PHONE_NUMBER,
    paymentsDeps,
    mercadoPagoWebhookSecret: env.MERCADO_PAGO_WEBHOOK_SECRET,
  });

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT }, 'servidor no ar');
}

main().catch((erro) => {
  logger.error({ err: erro }, 'falha fatal ao iniciar a aplicação');
  process.exit(1);
});
