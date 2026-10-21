import { getContentType, normalizeMessageContent, type WAMessage } from 'baileys';
import { trecho } from '../../shared/logger/logger.js';

/**
 * Prefixo invisível colocado nas respostas do bot no modo autoteste. Quando
 * bot e usuário escrevem no mesmo chat (o "você mesmo"), é ele que impede o
 * bot de reprocessar as próprias respostas em loop.
 */
export const MARCADOR_BOT = '⁣';

const TIPOS_DE_MIDIA = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  stickerMessage: 'sticker',
  documentMessage: 'document',
  documentWithCaptionMessage: 'document',
} as const;

type TipoDeMidia = (typeof TIPOS_DE_MIDIA)[keyof typeof TIPOS_DE_MIDIA];

/** O que interessa de uma mensagem do Baileys, já sem os envelopes do protocolo. */
export interface ConteudoMensagem {
  texto: string;
  midia?: TipoDeMidia;
}

/**
 * O Baileys entrega o conteúdo embrulhado em vários formatos (texto simples,
 * texto estendido, legenda de mídia, mensagem temporária, visualização única).
 * `normalizeMessageContent` tira os embrulhos; aqui juntamos o resto.
 */
export function conteudoDaMensagem(mensagem: WAMessage): ConteudoMensagem | undefined {
  const conteudo = normalizeMessageContent(mensagem.message);
  const tipo = getContentType(conteudo);
  if (!conteudo || !tipo) {
    return undefined;
  }
  if (tipo in TIPOS_DE_MIDIA) {
    const midia = TIPOS_DE_MIDIA[tipo as keyof typeof TIPOS_DE_MIDIA];
    const legenda =
      conteudo.imageMessage?.caption ??
      conteudo.videoMessage?.caption ??
      conteudo.documentMessage?.caption ??
      conteudo.documentWithCaptionMessage?.message?.documentMessage?.caption;
    return { texto: legenda ?? '', midia };
  }
  const texto = conteudo.conversation ?? conteudo.extendedTextMessage?.text;
  // Reações, enquetes, mensagens de protocolo etc. não têm texto para o bot.
  return typeof texto === 'string' ? { texto } : undefined;
}

export function ehRespostaDoBot(conteudo: ConteudoMensagem): boolean {
  return conteudo.texto.startsWith(MARCADOR_BOT);
}

/** Descrição curta do conteúdo, sem despejar mídia no log. */
export function resumoConteudo(conteudo: ConteudoMensagem): string {
  if (conteudo.midia) {
    return conteudo.texto ? `[${conteudo.midia}] ${trecho(conteudo.texto)}` : `[${conteudo.midia}]`;
  }
  return trecho(conteudo.texto);
}

/** `messageTimestamp` vem em segundos, como número ou como Long do protobuf. */
export function instanteDaMensagem(mensagem: WAMessage): Date {
  const bruto = mensagem.messageTimestamp;
  const segundos = typeof bruto === 'number' ? bruto : Number(bruto?.toString() ?? 0);
  return segundos > 0 ? new Date(segundos * 1000) : new Date();
}
