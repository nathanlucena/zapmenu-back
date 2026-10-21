import { rm } from 'node:fs/promises';
import path from 'node:path';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type WASocket,
} from 'baileys';
import qrcode from 'qrcode-terminal';
import { logger as loggerRaiz } from '../../shared/logger/logger.js';
import { telefoneDoChatId } from '../../shared/telefone/telefone.js';
import type { WhatsAppClient } from '../whatsapp-client.interface.js';
import { criarBaileysClient, type BaileysClientOptions } from './baileys-client.js';
import type { EnquetesStore } from './enquete.js';

export interface SessaoWhatsAppConfig {
  sessionName: string;
  tokenStorePath: string;
  modoAutoteste?: boolean;
  numerosPermitidos?: string[];
  /** Nível do log interno do Baileys. */
  logLevelBaileys?: string;
  /** Onde guardar as enquetes enviadas, para ler os votos mesmo depois de reiniciar. */
  enquetes?: EnquetesStore;
}

const BACKOFF_INICIAL_MS = 2_000;
const BACKOFF_MAXIMO_MS = 60_000;

/** Por que a conexão caiu, em português, para o log. */
const DESCRICAO_DESCONEXAO: Record<number, string> = {
  [DisconnectReason.connectionClosed]: 'conexão encerrada',
  [DisconnectReason.connectionLost]: 'conexão perdida ou expirou',
  [DisconnectReason.connectionReplaced]: 'outra conexão abriu esta mesma sessão',
  [DisconnectReason.loggedOut]: 'aparelho desconectado pelo celular',
  [DisconnectReason.badSession]: 'sessão salva corrompida',
  [DisconnectReason.restartRequired]: 'WhatsApp pediu para reiniciar a conexão (normal após ler o QR code)',
  [DisconnectReason.multideviceMismatch]: 'conta incompatível com aparelhos conectados',
  [DisconnectReason.forbidden]: 'acesso negado pelo WhatsApp',
  [DisconnectReason.unavailableService]: 'serviço do WhatsApp indisponível',
};

/**
 * A pasta é separada da que o WPPConnect usava (um perfil inteiro do Chrome):
 * o Baileys só guarda as chaves da sessão, e os dois formatos não se misturam.
 */
function pastaDaSessao(config: SessaoWhatsAppConfig): string {
  return path.resolve(config.tokenStorePath, `${config.sessionName}-baileys`);
}

/** Versão atual do WhatsApp Web; com uma versão velha o WhatsApp recusa a conexão. */
async function versaoDoWhatsApp(logger: typeof loggerRaiz): Promise<[number, number, number] | undefined> {
  try {
    const { version } = await fetchLatestBaileysVersion();
    return version;
  } catch (erro) {
    logger.warn({ err: erro }, 'não foi possível buscar a versão atual do WhatsApp Web; usando a do Baileys');
    return undefined;
  }
}

function codigoDaDesconexao(erro: unknown): number | undefined {
  return (erro as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
}

/**
 * O WhatsApp reentrega mensagens não confirmadas quando a sessão reconecta
 * (desde que não seja deslogada) — por isso não há fila própria de mensagens
 * aqui. Quem garante que uma reentrega não seja processada duas vezes é a
 * checagem de idempotência nos routers (`EventoProcessado`), não este módulo.
 */
export async function iniciarSessaoWhatsApp(
  config: SessaoWhatsAppConfig,
  registrarHandlers: (client: WhatsAppClient) => void,
): Promise<void> {
  let backoffAtualMs = BACKOFF_INICIAL_MS;
  const logger = loggerRaiz.child({ sessao: config.sessionName });
  const loggerBaileys = loggerRaiz.child(
    { sessao: config.sessionName, modulo: 'baileys' },
    { level: config.logLevelBaileys ?? 'warn' },
  );
  const pasta = pastaDaSessao(config);

  function agendarReconexao(): void {
    logger.warn({ backoffAtualMs }, 'reagendando reconexão da sessão WhatsApp');
    setTimeout(() => {
      iniciar().catch((erro: unknown) => {
        logger.error({ err: erro }, 'falha ao reconectar sessão WhatsApp');
        agendarReconexao();
      });
    }, backoffAtualMs);
    backoffAtualMs = Math.min(backoffAtualMs * 2, BACKOFF_MAXIMO_MS);
  }

  function aoConectar(socket: WASocket): void {
    backoffAtualMs = BACKOFF_INICIAL_MS;
    const telefoneConectado = telefoneDoChatId(jidNormalizedUser(socket.user?.id));

    const options: BaileysClientOptions = { sessao: config.sessionName, enquetes: config.enquetes };
    if (config.modoAutoteste) {
      const numerosPermitidos = config.numerosPermitidos ?? [];
      options.autoteste = { telefoneProprio: telefoneConectado, numerosPermitidos };
      logger.warn(
        { contaConectada: telefoneConectado, numerosPermitidos },
        'MODO AUTOTESTE: só atende o chat consigo mesmo e os números permitidos; envios a outros números são bloqueados',
      );
    }
    registrarHandlers(criarBaileysClient(socket, options));
    logger.info({ telefone: telefoneConectado }, '✅ sessão WhatsApp pronta');
  }

  async function aoDesconectar(erro: unknown): Promise<void> {
    const codigo = codigoDaDesconexao(erro);
    const descricao = (codigo === undefined ? undefined : DESCRICAO_DESCONEXAO[codigo]) ?? 'conexão caiu';

    if (codigo === DisconnectReason.restartRequired) {
      logger.info({ codigo }, descricao);
      await iniciar();
      return;
    }
    if (codigo === DisconnectReason.loggedOut || codigo === DisconnectReason.badSession) {
      // As chaves salvas não servem mais; sem apagá-las o Baileys tentaria de
      // novo com elas para sempre em vez de mostrar um QR code novo.
      logger.warn({ codigo, pasta }, `${descricao} — apagando a sessão salva para gerar um QR code novo`);
      await rm(pasta, { recursive: true, force: true });
    } else {
      logger.warn({ codigo, err: erro }, descricao);
    }
    agendarReconexao();
  }

  async function iniciar(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(pasta);
    const version = await versaoDoWhatsApp(logger);

    const socket = makeWASocket({
      ...(version && { version }),
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, loggerBaileys) },
      logger: loggerBaileys,
      browser: Browsers.ubuntu('ZapMenu'),
      // Sem isso o celular deixa de receber notificações enquanto o bot está conectado.
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    socket.ev.on('creds.update', () => {
      saveCreds().catch((erro: unknown) => logger.error({ err: erro }, 'falha ao salvar a sessão do WhatsApp'));
    });

    socket.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        logger.info('📱 QR code gerado — no celular: WhatsApp → Aparelhos conectados → Conectar aparelho');
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'open') {
        aoConectar(socket);
      } else if (connection === 'close') {
        aoDesconectar(lastDisconnect?.error).catch((erro: unknown) => {
          logger.error({ err: erro }, 'falha ao tratar a queda da sessão WhatsApp');
          agendarReconexao();
        });
      }
    });
  }

  try {
    await iniciar();
  } catch (erro) {
    // Não relança: a reconexão agendada cuida disso, e o resto da aplicação
    // (HTTP, outra sessão) continua no ar enquanto isso.
    logger.error({ err: erro }, 'falha ao iniciar sessão WhatsApp, tentando novamente');
    agendarReconexao();
  }
}
