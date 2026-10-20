import { create, defaultLogger, SocketState, type Whatsapp } from '@wppconnect-team/wppconnect';
import { logger as loggerRaiz } from '../../shared/logger/logger.js';
import type { WhatsAppClient } from '../whatsapp-client.interface.js';
import { criarWppConnectClient, telefoneDoChatId, type WppConnectClientOptions } from './wppconnect-client.js';

export interface SessaoWppConnectConfig {
  sessionName: string;
  tokenStorePath: string;
  headless: boolean;
  chromiumExecutablePath?: string;
  modoAutoteste?: boolean;
  numerosPermitidos?: string[];
  /** Nível do logger interno (winston) do WPPConnect. */
  logLevelWppConnect?: string;
}

/** Tradução dos status do `statusFind` do WPPConnect para algo legível. */
const DESCRICAO_STATUS: Record<string, string> = {
  notLogged: 'sessão não autenticada — aguardando leitura do QR code',
  qrReadSuccess: 'QR code lido com sucesso',
  qrReadFail: 'falha ao ler o QR code',
  qrReadError: 'erro ao ler o QR code',
  isLogged: 'sessão já autenticada (token salvo reaproveitado)',
  inChat: 'WhatsApp Web carregado — pronto para receber mensagens',
  autocloseCalled: 'QR code não foi lido a tempo — sessão fechada automaticamente',
  browserClose: 'navegador da sessão foi fechado',
  desconnectedMobile: 'celular desconectou a sessão (aparelho removido?)',
  disconnectedMobile: 'celular desconectou a sessão (aparelho removido?)',
  phoneNotConnected: 'celular sem conexão com a internet',
  serverClose: 'conexão com o servidor do WhatsApp foi encerrada',
  deleteToken: 'token da sessão apagado',
  unpaired: 'aparelho desvinculado da conta',
  unpairedIdle: 'aparelho desvinculado por inatividade',
};

const STATUS_DE_ERRO = new Set([
  'qrReadFail',
  'qrReadError',
  'autocloseCalled',
  'browserClose',
  'desconnectedMobile',
  'disconnectedMobile',
  'phoneNotConnected',
  'serverClose',
  'unpaired',
  'unpairedIdle',
]);

const ESTADOS_QUE_EXIGEM_RECONEXAO = new Set<SocketState>([
  SocketState.CONFLICT,
  SocketState.UNPAIRED,
  SocketState.UNPAIRED_IDLE,
  SocketState.TIMEOUT,
]);

const BACKOFF_INICIAL_MS = 2_000;
const BACKOFF_MAXIMO_MS = 60_000;

/**
 * O WhatsApp Web reentrega mensagens não confirmadas quando a sessão reconecta
 * (desde que não seja deslogada) — por isso não há fila própria de mensagens
 * aqui. Quem garante que uma reentrega não seja processada duas vezes é a
 * checagem de idempotência nos routers (`EventoProcessado`), não este módulo.
 */
/** Navegadores abertos por todas as sessões, para fechá-los ao encerrar o processo. */
const navegadoresAbertos = new Set<Whatsapp>();
let encerramentoRegistrado = false;

async function fecharNavegador(whatsapp: Whatsapp): Promise<void> {
  navegadoresAbertos.delete(whatsapp);
  await whatsapp.close().catch(() => undefined);
}

/**
 * Sem isso, Ctrl+C ou o restart do `tsx watch` matam o Node e deixam o Chrome
 * órfão segurando a pasta da sessão ("The browser is already running").
 */
function registrarEncerramento(): void {
  if (encerramentoRegistrado) {
    return;
  }
  encerramentoRegistrado = true;
  const encerrar = (sinal: NodeJS.Signals): void => {
    loggerRaiz.info({ sinal }, 'encerrando: fechando navegadores do WhatsApp');
    const limite = new Promise((resolve) => setTimeout(resolve, 5_000));
    void Promise.race([Promise.all([...navegadoresAbertos].map(fecharNavegador)), limite]).finally(() =>
      process.exit(0),
    );
  };
  process.once('SIGINT', encerrar);
  process.once('SIGTERM', encerrar);
}

export async function iniciarSessaoWppConnect(
  config: SessaoWppConnectConfig,
  registrarHandlers: (client: WhatsAppClient) => void,
): Promise<void> {
  let backoffAtualMs = BACKOFF_INICIAL_MS;
  const logger = loggerRaiz.child({ sessao: config.sessionName });

  // O logger do WPPConnect é global e vem em "silly"; sem isso cada mensagem
  // gera várias linhas de "Emitting ... event" no terminal.
  defaultLogger.level = config.logLevelWppConnect ?? 'warn';
  registrarEncerramento();

  function agendarReconexao(): void {
    logger.warn({ backoffAtualMs }, 'reagendando reconexão da sessão WPPConnect');
    setTimeout(() => {
      iniciar().catch((erro: unknown) => {
        logger.error({ err: erro }, 'falha ao reconectar sessão WPPConnect');
      });
    }, backoffAtualMs);
    backoffAtualMs = Math.min(backoffAtualMs * 2, BACKOFF_MAXIMO_MS);
  }

  async function iniciar(): Promise<void> {
    const whatsapp = await create({
      session: config.sessionName,
      folderNameToken: config.tokenStorePath,
      headless: config.headless,
      // Passar `puppeteerOptions: undefined` sobrescreve o `{}` padrão do
      // WPPConnect e ele quebra ao definir `userDataDir` — por isso a chave
      // só entra quando há um executável customizado.
      ...(config.chromiumExecutablePath && {
        puppeteerOptions: { executablePath: config.chromiumExecutablePath },
      }),
      disableWelcome: true,
      updatesLog: false,
      catchQR: (_base64Qr, asciiQR, tentativa) => {
        logger.info(
          { tentativa },
          '📱 QR code gerado — no celular: WhatsApp → Aparelhos conectados → Conectar aparelho',
        );
        if (asciiQR) {
          console.log(asciiQR);
        }
      },
      statusFind: (status) => {
        const descricao = DESCRICAO_STATUS[status] ?? 'status da sessão';
        if (STATUS_DE_ERRO.has(status)) {
          logger.warn({ status }, descricao);
        } else {
          logger.info({ status }, descricao);
        }
      },
    });
    navegadoresAbertos.add(whatsapp);

    let telefoneConectado: string;
    try {
      telefoneConectado = await obterNumeroConectado(whatsapp);
    } catch (erro) {
      // Sem fechar, o Chrome continua preso à pasta da sessão e a reconexão
      // falha com "The browser is already running".
      await fecharNavegador(whatsapp);
      throw erro;
    }
    backoffAtualMs = BACKOFF_INICIAL_MS;

    const options: WppConnectClientOptions = { sessao: config.sessionName };
    if (config.modoAutoteste) {
      const numerosPermitidos = config.numerosPermitidos ?? [];
      options.autoteste = { telefoneProprio: telefoneConectado, numerosPermitidos };
      logger.warn(
        { contaConectada: telefoneConectado, numerosPermitidos },
        'MODO AUTOTESTE: só atende o chat consigo mesmo e os números permitidos; envios a outros números são bloqueados',
      );
    }
    registrarHandlers(criarWppConnectClient(whatsapp, options));
    logger.info({ telefone: telefoneConectado }, '✅ sessão WhatsApp pronta');

    let reconectando = false;
    whatsapp.onStateChange((state) => {
      if (ESTADOS_QUE_EXIGEM_RECONEXAO.has(state)) {
        if (reconectando) {
          return;
        }
        reconectando = true;
        logger.warn({ state }, 'sessão caiu — agendando reconexão');
        // O navegador antigo precisa sair antes: a reconexão usa a mesma pasta.
        void fecharNavegador(whatsapp).finally(agendarReconexao);
      } else {
        logger.info({ state }, 'mudança de estado da conexão com o WhatsApp');
      }
    });
  }

  try {
    await iniciar();
  } catch (erro) {
    // Não relança: a reconexão agendada cuida disso, e o resto da aplicação
    // (HTTP, outra sessão) continua no ar enquanto isso.
    logger.error({ err: erro }, 'falha ao iniciar sessão WPPConnect, tentando novamente');
    agendarReconexao();
  }
}

/**
 * O `create()` do WPPConnect resolve antes de o script WAPI estar injetado na
 * página (e a página pode recarregar logo após o login), então chamar
 * `getWid()` direto às vezes dá "WAPI is not defined". Espera ele ficar pronto.
 */
async function obterNumeroConectado(whatsapp: Whatsapp): Promise<string> {
  const TENTATIVAS = 5;
  for (let tentativa = 1; ; tentativa++) {
    try {
      await whatsapp.page.waitForFunction(
        () => {
          const wapi = (globalThis as { WAPI?: { getWid?: () => unknown } }).WAPI;
          try {
            return typeof wapi?.getWid === 'function' && Boolean(wapi.getWid());
          } catch {
            return false;
          }
        },
        { timeout: 60_000, polling: 1_000 },
      );
      return telefoneDoChatId(await whatsapp.getWid());
    } catch (erro) {
      // Recarregamento da página destrói o contexto no meio da espera.
      if (tentativa >= TENTATIVAS) {
        throw erro;
      }
    }
  }
}
