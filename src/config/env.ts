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

  // Nível do log interno do Baileys. Em "debug" ou "trace" ele registra cada
  // pacote trocado com o WhatsApp. Os níveis antigos do WPPConnect continuam valendo.
  WPP_LOG_LEVEL: z
    .enum(['silent', 'fatal', 'error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly', 'trace'])
    .default('warn')
    .transform((nivel) => ({ http: 'debug', verbose: 'debug', silly: 'trace' })[nivel as string] ?? nivel),

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
  // Consultas ao Google Geocoding por dia antes de o app recusar (300 x 31 dias fica abaixo das
  // 10 mil grátis por mês). Respostas repetidas saem do cache e não contam. 0 = sem limite interno.
  GOOGLE_GEOCODING_LIMITE_DIARIO: z.coerce.number().int().min(0).default(300),

  MERCADO_PAGO_ACCESS_TOKEN: z.string().min(1),
  MERCADO_PAGO_WEBHOOK_SECRET: z.string().min(1),
  MERCADO_PAGO_NOTIFICATION_URL: z.string().url(),
  // Só com credenciais de teste: vai como payer.first_name da order ("APRO" aprova o PIX de teste). Vazia = desligada.
  MERCADO_PAGO_PAGADOR_TESTE: z
    .string()
    .optional()
    .transform((valor) => valor || undefined),

  // Assinatura do ZapMenu pelas lojas (Mercado Pago Assinaturas), na conta do próprio ZapMenu:
  // credenciais separadas das que cobram os PIX das lojas. Sem token, "assinar" fica indisponível.
  MERCADO_PAGO_ASSINATURAS_ACCESS_TOKEN: z
    .string()
    .optional()
    .transform((valor) => valor?.trim() || undefined),
  // Assinatura secreta do webhook dessa aplicação. Obrigatória junto com o token.
  MERCADO_PAGO_ASSINATURAS_WEBHOOK_SECRET: z
    .string()
    .optional()
    .transform((valor) => valor?.trim() || undefined),
  // Credenciais de teste: manda o link do sandbox. Só desligue com credenciais de produção.
  MERCADO_PAGO_ASSINATURAS_SANDBOX: z.stringbool().default(true),
  // Para onde o Mercado Pago leva a loja depois de cadastrar o cartão. Vazio: o endereço público do app.
  ASSINATURA_URL_RETORNO: z
    .string()
    .optional()
    .transform((valor) => valor?.trim() || undefined),
  // De quanto em quanto tempo o job das assinaturas roda (cada aviso sai uma vez por dia).
  ASSINATURAS_VERIFICACAO_INTERVALO_MINUTOS: z.coerce.number().positive().default(60),

  // Transcrição de áudios (Profissional) por uma API compatível com a da OpenAI (/audio/transcriptions):
  // OpenAI (https://api.openai.com/v1, whisper-1) ou Groq (https://api.groq.com/openai/v1, whisper-large-v3).
  // Sem chave, o bot pede para escrever.
  TRANSCRICAO_API_URL: z.string().url().default('https://api.openai.com/v1'),
  TRANSCRICAO_API_KEY: z
    .string()
    .optional()
    .transform((valor) => valor?.trim() || undefined),
  TRANSCRICAO_MODELO: z.string().default('whisper-1'),

  PEDIDO_TTL_MINUTOS: z.coerce.number().default(20),
  // Quanto tempo a loja tem para aceitar ou recusar um pedido depois que o cliente manda o código.
  PEDIDO_ACEITE_MINUTOS: z.coerce.number().int().positive().default(15),
  // Pedido em preparo/a caminho há mais que isso (desde a criação) é concluído sozinho.
  PEDIDO_CONCLUSAO_HORAS: z.coerce.number().positive().default(12),
  PAGAMENTO_POLLING_INTERVALO_SEGUNDOS: z.coerce.number().default(60),
  // Só no modo autoteste: o PIX é dado como pago N segundos depois de gerado. 0 desliga.
  PAGAMENTO_SIMULADO_SEGUNDOS: z.coerce.number().int().min(0).default(30),

  FRONTEND_ALLOWED_ORIGIN: z.string().min(1),
  // Endereço público do app (ex.: o domínio do ngrok), usado nos links mandados no WhatsApp. Vazio: FRONTEND_ALLOWED_ORIGIN.
  // Como o backend alcança o front (para a imagem da prévia). Vazio: FRONTEND_ALLOWED_ORIGIN.
  FRONTEND_URL_INTERNA: z
    .string()
    .optional()
    .transform((valor) => valor?.trim() || undefined),
  FRONTEND_URL_PUBLICA: z
    .string()
    .optional()
    .transform((valor) => valor?.trim() || undefined),
});

const envValidado = envSchema.refine(
  (env) => !env.MERCADO_PAGO_ASSINATURAS_ACCESS_TOKEN || env.MERCADO_PAGO_ASSINATURAS_WEBHOOK_SECRET,
  {
    message: 'MERCADO_PAGO_ASSINATURAS_WEBHOOK_SECRET é obrigatória junto com MERCADO_PAGO_ASSINATURAS_ACCESS_TOKEN',
    path: ['MERCADO_PAGO_ASSINATURAS_WEBHOOK_SECRET'],
  },
);

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envValidado.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Configuração de ambiente inválida:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}
