import { randomBytes } from 'node:crypto';
import {
  downloadMediaMessage,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  normalizeMessageContent,
  type proto,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
} from 'baileys';
import { logger as loggerRaiz, trecho } from '../../shared/logger/logger.js';
import { chaveTelefone, telefoneDoChatId } from '../../shared/telefone/telefone.js';
import type {
  ManipuladorMensagem,
  ManipuladorVoto,
  MensagemRecebida,
  WhatsAppClient,
} from '../whatsapp-client.interface.js';
import { criarEnquetesEmMemoria, lerVoto, type EnquetesStore } from './enquete.js';
import {
  conteudoDaMensagem,
  ehRespostaDoBot,
  instanteDaMensagem,
  MARCADOR_BOT,
  resumoConteudo,
  type ConteudoMensagem,
} from './mensagem.js';

export interface ModoAutoteste {
  /** Número da própria conta conectada (sem sufixo). */
  telefoneProprio: string;
  /** Outros números com quem o bot pode conversar durante o teste. */
  numerosPermitidos: string[];
}

export interface BaileysClientOptions {
  /** Nome da sessão, para identificar nos logs de qual número veio o evento. */
  sessao?: string;
  autoteste?: ModoAutoteste;
  /** Onde guardar as enquetes enviadas; sem isso, ficam só em memória (voto depois de reiniciar se perde). */
  enquetes?: EnquetesStore;
}

function ehConversaIndividual(jid: string): boolean {
  return Boolean(isPnUser(jid) || isLidUser(jid));
}

/** Data URI a partir do que o Baileys baixou, no mesmo formato que o resto do domínio já guarda. */
function paraDataUri(buffer: Buffer, mimetype: string | null | undefined): string {
  return `data:${mimetype ?? 'image/jpeg'};base64,${buffer.toString('base64')}`;
}

/**
 * Data URI, URL http(s) ou base64 puro (o QR do PIX vem assim do Mercado
 * Pago). Sem esse último caso, o base64 seria tratado como URL e o envio falharia.
 */
function imagemParaEnvio(imagemUrlOuBase64: string): Buffer | { url: string } {
  const dataUri = /^data:[^;]+;base64,(.*)$/s.exec(imagemUrlOuBase64);
  if (dataUri) {
    return Buffer.from(dataUri[1] ?? '', 'base64');
  }
  if (/^https?:\/\//i.test(imagemUrlOuBase64)) {
    return { url: imagemUrlOuBase64 };
  }
  return Buffer.from(imagemUrlOuBase64.replace(/\s/g, ''), 'base64');
}

/**
 * A mídia recebida vira uma data URI base64 (não uma URL http) e é guardada
 * assim mesmo em `imagemUrl`, já que o resto do domínio só usa o valor como
 * anexo opaco a ser reenviado, nunca busca a URL de fato.
 */
export function criarBaileysClient(socket: WASocket, options: BaileysClientOptions = {}): WhatsAppClient {
  const { autoteste } = options;
  const enquetes = options.enquetes ?? criarEnquetesEmMemoria();
  const logger = loggerRaiz.child({ sessao: options.sessao });
  const chavesPermitidas = new Set(
    autoteste ? [autoteste.telefoneProprio, ...autoteste.numerosPermitidos].map(chaveTelefone) : [],
  );
  /** Telefone → JID com que o WhatsApp conhece o número (com ou sem o 9º dígito). */
  const destinos = new Map<string, string>();

  /** A própria conta aparece com dois IDs: o do telefone e o LID. */
  function idsProprios(): Set<string> {
    const ids = [socket.user?.id, socket.user?.lid].filter((id): id is string => Boolean(id));
    return new Set(ids.map(jidNormalizedUser));
  }

  /**
   * Contas novas chegam como `<id>@lid`, que não é o telefone. O Baileys às
   * vezes já manda o telefone junto (`remoteJidAlt`); senão consultamos o
   * mapeamento LID → telefone, para que respostas, filtros e o cadastro usem
   * sempre o telefone real.
   */
  async function telefoneDoChat(chave: WAMessageKey): Promise<string> {
    const jid = chave.remoteJid ?? '';
    if (isPnUser(jid)) {
      return telefoneDoChatId(jidNormalizedUser(jid));
    }
    if (chave.remoteJidAlt && isPnUser(chave.remoteJidAlt)) {
      return telefoneDoChatId(jidNormalizedUser(chave.remoteJidAlt));
    }
    if (isLidUser(jid)) {
      try {
        const telefone = await socket.signalRepository.lidMapping.getPNForLID(jid);
        if (telefone) {
          return telefoneDoChatId(jidNormalizedUser(telefone));
        }
      } catch (erro) {
        logger.warn({ err: erro, jid }, 'não foi possível converter @lid em telefone');
      }
    }
    return jid;
  }

  function ehChatProprio(chave: WAMessageKey): boolean {
    return Boolean(chave.fromMe && chave.remoteJid && idsProprios().has(jidNormalizedUser(chave.remoteJid)));
  }

  /** Telefone de quem escreveu, ou o motivo para ignorar a mensagem. */
  async function avaliarRemetente(
    chave: WAMessageKey,
    conteudo: ConteudoMensagem,
  ): Promise<{ telefone: string } | { motivo: string }> {
    const jid = chave.remoteJid ?? '';
    if (conteudo.midia && conteudo.midia !== 'image') {
      return { motivo: `mídia não suportada (${conteudo.midia})` };
    }
    if (!ehConversaIndividual(jid)) {
      return { motivo: 'grupo, status ou canal' };
    }
    if (!autoteste) {
      return chave.fromMe ? { motivo: 'enviada por esta conta' } : { telefone: await telefoneDoChat(chave) };
    }

    if (ehChatProprio(chave)) {
      return ehRespostaDoBot(conteudo) ? { motivo: 'é a própria resposta do bot' } : { telefone: autoteste.telefoneProprio };
    }
    if (chave.fromMe) {
      return { motivo: 'enviada por esta conta para outro chat' };
    }

    const telefone = await telefoneDoChat(chave);
    if (!chavesPermitidas.has(chaveTelefone(telefone))) {
      return { motivo: `modo autoteste: ${telefone} não está em WPP_NUMEROS_PERMITIDOS` };
    }
    return { telefone };
  }

  function destinoPermitido(telefone: string): boolean {
    if (!autoteste || chavesPermitidas.has(chaveTelefone(telefone))) {
      return true;
    }
    logger.warn({ destino: telefone }, '🚫 modo autoteste: envio para número não permitido bloqueado');
    return false;
  }

  /**
   * Números brasileiros antigos existem no WhatsApp sem o 9º dígito. Perguntar
   * ao WhatsApp devolve o JID certo; a resposta fica em cache por telefone.
   */
  async function jidDeDestino(telefone: string): Promise<string> {
    if (telefone.includes('@')) {
      return telefone;
    }
    const emCache = destinos.get(telefone);
    if (emCache) {
      return emCache;
    }
    const padrao = `${telefone.replace(/\D/g, '')}@s.whatsapp.net`;
    try {
      const [resultado] = (await socket.onWhatsApp(telefone)) ?? [];
      if (resultado?.exists) {
        destinos.set(telefone, resultado.jid);
        return resultado.jid;
      }
      logger.warn({ destino: telefone }, 'número não encontrado no WhatsApp; enviando mesmo assim');
    } catch (erro) {
      logger.warn({ err: erro, destino: telefone }, 'não foi possível consultar o número no WhatsApp');
    }
    return padrao;
  }

  function marcar(texto: string): string {
    return autoteste ? `${MARCADOR_BOT}${texto}` : texto;
  }

  async function baixarImagem(mensagem: WAMessage): Promise<string> {
    const buffer = await downloadMediaMessage(
      mensagem,
      'buffer',
      {},
      { logger: logger.child({ modulo: 'baileys' }), reuploadRequest: socket.updateMediaMessage },
    );
    return paraDataUri(buffer, mensagem.message?.imageMessage?.mimetype);
  }

  /** Telefone de quem votou, ou undefined quando o voto deve ser ignorado (mesmas regras das mensagens). */
  async function telefoneDoVoto(chave: WAMessageKey): Promise<string | undefined> {
    if (chave.fromMe) {
      return autoteste && ehChatProprio(chave) ? autoteste.telefoneProprio : undefined;
    }
    if (!ehConversaIndividual(chave.remoteJid ?? '')) {
      return undefined;
    }
    const telefone = await telefoneDoChat(chave);
    return !autoteste || chavesPermitidas.has(chaveTelefone(telefone)) ? telefone : undefined;
  }

  async function tratarVoto(
    mensagem: WAMessage,
    atualizacao: proto.Message.IPollUpdateMessage,
    manipulador: ManipuladorVoto,
  ): Promise<void> {
    const chave = mensagem.key;
    const enqueteId = atualizacao.pollCreationMessageKey?.id;
    const enquete = enqueteId ? await enquetes.buscar(enqueteId) : null;
    if (!enquete || !atualizacao.vote || !chave.id) {
      logger.info({ enqueteId }, '🗳️ voto em enquete desconhecida, ignorado');
      return;
    }

    const telefone = await telefoneDoVoto(chave);
    if (!telefone) {
      logger.info({ chat: chave.remoteJid }, '🗳️ voto ignorado (remetente fora das regras)');
      return;
    }

    const proprios = [...idsProprios()];
    const votantes = chave.fromMe
      ? proprios
      : [chave.participantAlt, chave.remoteJidAlt, chave.participant, chave.remoteJid]
          .filter((jid): jid is string => Boolean(jid))
          .map(jidNormalizedUser);
    const opcoes = lerVoto(enquete, atualizacao.vote, [enquete.criadorJid, ...proprios], votantes);
    if (!opcoes) {
      logger.warn({ enqueteId, telefone }, '🗳️ não foi possível decifrar o voto da enquete');
      return;
    }

    logger.info({ telefone, enqueteId, opcoes }, '🗳️ VOTO RECEBIDO');
    try {
      await manipulador({ id: chave.id, telefone, enqueteId: enquete.id, opcoes });
    } catch (erro) {
      logger.error({ err: erro, enqueteId }, '💥 erro ao processar voto');
    }
  }

  return {
    async sendText(telefone, texto) {
      if (!destinoPermitido(telefone)) {
        return;
      }
      await socket.sendMessage(await jidDeDestino(telefone), { text: marcar(texto) });
      logger.info({ para: telefone, conteudo: trecho(texto) }, '🤖 BOT RESPONDEU');
    },

    async sendTyping(telefone) {
      if (!destinoPermitido(telefone)) {
        return;
      }
      await socket.sendPresenceUpdate('composing', await jidDeDestino(telefone));
    },

    async sendImage(telefone, imagemUrlOuBase64, legenda) {
      if (!destinoPermitido(telefone)) {
        return;
      }
      await socket.sendMessage(await jidDeDestino(telefone), {
        image: imagemParaEnvio(imagemUrlOuBase64),
        caption: marcar(legenda ?? ''),
      });
      logger.info({ para: telefone, conteudo: `[imagem] ${legenda ? trecho(legenda) : ''}` }, '🤖 BOT RESPONDEU');
    },

    onMessage(manipulador: ManipuladorMensagem) {
      const tratar = async (mensagem: WAMessage) => {
        const chave = mensagem.key;
        const conteudo = conteudoDaMensagem(mensagem);
        if (!conteudo || !chave.id) {
          return;
        }
        // Uma linha por mensagem que passa pela sessão — recebida ou enviada —
        // com a decisão tomada, para dar para acompanhar o teste pelo terminal.
        const direcao = chave.fromMe ? '📤 ENVIADA ' : '📩 RECEBIDA';
        const resumo = { chat: chave.remoteJid, conteudo: resumoConteudo(conteudo) };

        const avaliacao = await avaliarRemetente(chave, conteudo);
        if ('motivo' in avaliacao) {
          logger.info({ ...resumo, motivo: avaliacao.motivo }, `${direcao} 🙈 ignorada`);
          return;
        }

        logger.info({ ...resumo, telefone: avaliacao.telefone }, `${direcao} ✅ processando`);

        let imagemUrl: string | undefined;
        if (conteudo.midia === 'image') {
          try {
            imagemUrl = await baixarImagem(mensagem);
          } catch (erro) {
            logger.warn({ err: erro, mensagemId: chave.id }, 'Falha ao baixar mídia recebida do WhatsApp');
          }
        }

        const mensagemRecebida: MensagemRecebida = {
          id: chave.id,
          telefone: avaliacao.telefone,
          corpo: conteudo.texto,
          imagemUrl,
          timestamp: instanteDaMensagem(mensagem),
        };

        try {
          await manipulador(mensagemRecebida);
        } catch (erro) {
          logger.error({ err: erro, mensagemId: chave.id }, '💥 erro ao processar mensagem');
        }
      };

      // "notify" são mensagens novas; "append" é histórico e eco do que o
      // próprio socket enviou, que não deve ser respondido.
      socket.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') {
          return;
        }
        for (const mensagem of messages) {
          tratar(mensagem).catch((erro: unknown) => {
            logger.error({ err: erro, mensagemId: mensagem.key.id }, '💥 erro ao avaliar mensagem');
          });
        }
      });
    },
    async sendPoll(telefone, pergunta, opcoes) {
      if (!destinoPermitido(telefone)) {
        return undefined;
      }
      // O segredo é nosso: sem ele (e sem guardar), o voto que chega não pode ser lido.
      const segredo = randomBytes(32);
      const enviada = await socket.sendMessage(await jidDeDestino(telefone), {
        poll: { name: pergunta, values: opcoes, selectableCount: 1, messageSecret: segredo },
      });
      const id = enviada?.key.id;
      if (!id) {
        return undefined;
      }
      await enquetes.guardar({
        id,
        segredo: segredo.toString('base64'),
        criadorJid: jidNormalizedUser(socket.user?.id),
        opcoes,
      });
      logger.info({ para: telefone, pergunta: trecho(pergunta), opcoes }, '🤖 BOT ENVIOU ENQUETE');
      return id;
    },

    onPollVote(manipulador) {
      socket.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') {
          return;
        }
        for (const mensagem of messages) {
          const atualizacao = normalizeMessageContent(mensagem.message)?.pollUpdateMessage;
          if (atualizacao) {
            tratarVoto(mensagem, atualizacao, manipulador).catch((erro: unknown) => {
              logger.error({ err: erro, mensagemId: mensagem.key.id }, '💥 erro ao avaliar voto');
            });
          }
        }
      });
    },
  };
}
