import { chamarServico } from '../../shared/errors/integracao-error.js';
import type { Transcritor } from '../application/ports/transcritor.js';

export interface OpcoesTranscritor {
  /** Base da API, ex.: https://api.openai.com/v1 ou https://api.groq.com/openai/v1. */
  url: string;
  chave: string;
  /** Ex.: whisper-1 (OpenAI), whisper-large-v3 (Groq). */
  modelo: string;
}

const EXTENSOES: Record<string, string> = { ogg: 'ogg', mpeg: 'mp3', mp4: 'm4a', wav: 'wav', webm: 'webm' };

function nomeDoArquivo(mimetype: string): string {
  const tipo = mimetype.split(';')[0]?.split('/')[1] ?? 'ogg';
  return `audio.${EXTENSOES[tipo] ?? 'ogg'}`;
}

/**
 * Transcrição pela rota /audio/transcriptions, no formato da OpenAI (que a Groq
 * também aceita). O áudio vai só na requisição; nada é guardado aqui.
 */
export function criarTranscritorOpenAiCompativel(opcoes: OpcoesTranscritor, fetchFn: typeof fetch = fetch): Transcritor {
  return {
    async transcrever(audio) {
      const formulario = new FormData();
      formulario.append('file', new Blob([new Uint8Array(audio.dados)], { type: audio.mimetype.split(';')[0] }), nomeDoArquivo(audio.mimetype));
      formulario.append('model', opcoes.modelo);
      formulario.append('language', 'pt');
      formulario.append('response_format', 'json');
      const resposta = await chamarServico('transcricao', 'Falha ao transcrever o áudio', () =>
        fetchFn(`${opcoes.url.replace(/\/$/, '')}/audio/transcriptions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${opcoes.chave}` },
          body: formulario,
          signal: AbortSignal.timeout(15_000),
        }),
      );
      if (!resposta.ok) {
        throw new Error(`Transcrição respondeu ${resposta.status}.`);
      }
      return ((await resposta.json()) as { text?: string }).text ?? '';
    },
  };
}
