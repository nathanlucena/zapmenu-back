import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1),

  WPP_MENU_SESSION_NAME: z.string().min(1),
  WPP_MENU_PHONE_NUMBER: z.string().min(1),
  WPP_MENU_TOKEN_STORE_PATH: z.string().min(1),

  WPP_ORDERS_SESSION_NAME: z.string().min(1),
  WPP_ORDERS_PHONE_NUMBER: z.string().min(1),
  WPP_ORDERS_TOKEN_STORE_PATH: z.string().min(1),

  // z.coerce.boolean() trataria a string "false" como true.
  WPP_HEADLESS: z.stringbool().default(true),
  WPP_CHROMIUM_EXECUTABLE_PATH: z.string().optional(),
  // Nível do log interno do WPPConnect (winston). Vem em "silly" de fábrica,
  // o que inunda o terminal com um "Emitting ... event" por mensagem.
  WPP_LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('warn'),

  // Quais sessões WhatsApp sobem no boot (ex.: "menu" para testar só a gestão).
  WPP_SESSOES: z
    .string()
    .default('menu,orders')
    .transform((valor) => valor.split(',').map((sessao) => sessao.trim()).filter(Boolean))
    .pipe(z.array(z.enum(['menu', 'orders'])).min(1)),

  // Teste manual: só atende o chat consigo mesmo da conta conectada e os
  // WPP_NUMEROS_PERMITIDOS, e bloqueia qualquer envio para outros números.
  WPP_MODO_AUTOTESTE: z.stringbool().default(false),
  // Números (além da própria conta) que o bot atende no modo autoteste.
  WPP_NUMEROS_PERMITIDOS: z
    .string()
    .default('')
    .transform((valor) => valor.split(',').map((numero) => numero.replace(/\D/g, '')).filter(Boolean)),

  // Telefones que podem usar o número de gestão. Vazio = qualquer um (com aviso no boot).
  GESTAO_TELEFONES_PERMITIDOS: z
    .string()
    .default('')
    .transform((valor) => valor.split(',').map((numero) => numero.replace(/\D/g, '')).filter(Boolean)),

  // IA que interpreta as mensagens de gestão. Sem chave, só as palavras-chave funcionam.
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default('deepseek-flash'),
  DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com'),

  // Converte o endereço da loja em coordenada (entrega por distância). Sem chave,
  // o cadastro de endereço avisa que está indisponível.
  GOOGLE_MAPS_API_KEY: z.string().optional(),

  MERCADO_PAGO_ACCESS_TOKEN: z.string().min(1),
  MERCADO_PAGO_WEBHOOK_SECRET: z.string().min(1),
  MERCADO_PAGO_NOTIFICATION_URL: z.string().url(),

  PEDIDO_TTL_MINUTOS: z.coerce.number().default(20),
  PAGAMENTO_POLLING_INTERVALO_SEGUNDOS: z.coerce.number().default(60),

  FRONTEND_ALLOWED_ORIGIN: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Configuração de ambiente inválida:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}
