import { logger } from '../../shared/logger/logger.js';
import { conferirCota, registrarUsoDaCota } from '../../planos/application/cotas.js';
import { mensagemRecursoDoPlano } from '../../planos/application/mensagens.js';
import type { AssinaturasRepository } from '../../planos/application/ports/assinaturas.repository.js';
import type { Transcritor } from './ports/transcritor.js';

/** Áudio maior que isso nem é transcrito. */
export const MAX_SEGUNDOS_AUDIO = 120;
/** Quanto esperar a transcrição antes de pedir para escrever. */
export const TEMPO_MAXIMO_TRANSCRICAO_MS = 15_000;

export const NAO_OUVI = 'Não consegui ouvir o áudio, pode escrever?';
export const AUDIO_DESLIGADO = 'Por aqui ainda não consigo ouvir áudios. Pode escrever?';
export const AUDIO_LONGO = 'O áudio passou de 2 minutos. Pode escrever ou mandar um áudio mais curto?';

/** O áudio como chegou do WhatsApp. `dados` fica só em memória e é descartado depois. */
export interface AudioRecebido {
  dados?: Uint8Array;
  mimetype: string;
  segundos?: number;
}

export interface OuvirAudioDeps {
  /** Sem ele (sem chave configurada), o recurso fica desligado. */
  transcritor?: Transcritor;
  cotas: Pick<AssinaturasRepository, 'obterOuIniciarTeste' | 'usoDaCota' | 'somarUsoDaCota'>;
  linkDosPlanos?: string;
}

/** O texto entendido, ou a resposta a mandar no lugar (desligado, longo, sem cota, falhou). */
export type ResultadoDoAudio = { tipo: 'TEXTO'; texto: string } | { tipo: 'RESPOSTA'; texto: string };

function comPrazo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promessa,
    new Promise<T>((_, rejeitar) => {
      timer = setTimeout(() => rejeitar(new Error('tempo esgotado')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Transcreve o áudio de quem fala com a loja `identificadorDaLoja` (o lojista
 * na gestão, ou o cliente de um pedido dela). Recurso AUDIO do plano, com a
 * cota de minutos do mês; o áudio não é guardado.
 */
export async function ouvirAudio(
  deps: OuvirAudioDeps,
  identificadorDaLoja: string,
  audio: AudioRecebido,
  quemFala: 'LOJISTA' | 'CLIENTE',
  agora: Date = new Date(),
): Promise<ResultadoDoAudio> {
  if (!deps.transcritor) {
    return { tipo: 'RESPOSTA', texto: AUDIO_DESLIGADO };
  }
  if ((audio.segundos ?? 0) > MAX_SEGUNDOS_AUDIO) {
    return { tipo: 'RESPOSTA', texto: AUDIO_LONGO };
  }
  if (!audio.dados) {
    return { tipo: 'RESPOSTA', texto: NAO_OUVI };
  }
  const segundos = Math.max(1, Math.ceil(audio.segundos ?? 0));
  const cota = await conferirCota(deps.cotas, identificadorDaLoja, 'AUDIO', 'minutosAudioMes', segundos, agora);
  if (!cota.ok) {
    if (quemFala === 'CLIENTE') {
      return { tipo: 'RESPOSTA', texto: AUDIO_DESLIGADO };
    }
    return {
      tipo: 'RESPOSTA',
      texto:
        cota.motivo === 'COTA_ESGOTADA'
          ? 'Os minutos de áudio do seu plano neste mês acabaram. Pode escrever?'
          : mensagemRecursoDoPlano('AUDIO', deps.linkDosPlanos),
    };
  }
  try {
    const texto = (await comPrazo(deps.transcritor.transcrever({ dados: audio.dados, mimetype: audio.mimetype }), TEMPO_MAXIMO_TRANSCRICAO_MS)).trim();
    if (!texto) {
      return { tipo: 'RESPOSTA', texto: NAO_OUVI };
    }
    await registrarUsoDaCota(deps.cotas, cota, 'minutosAudioMes', segundos);
    return { tipo: 'TEXTO', texto };
  } catch (erro) {
    logger.warn({ err: erro }, 'falha ao transcrever o áudio');
    return { tipo: 'RESPOSTA', texto: NAO_OUVI };
  }
}
