import type { Message, Whatsapp } from '@wppconnect-team/wppconnect';
import { logger as loggerRaiz, trecho } from '../../shared/logger/logger.js';
import { chaveTelefone, telefoneDoChatId } from '../../shared/telefone/telefone.js';
import type { ManipuladorMensagem, MensagemRecebida, WhatsAppClient } from '../whatsapp-client.interface.js';

/**
 * Prefixo invisível colocado nas respostas do bot no modo autoteste. Quando
 * bot e usuário escrevem no mesmo chat (o "você mesmo"), é ele que impede o
 * bot de reprocessar as próprias respostas em loop.
 */
const MARCADOR_BOT = '\u2063';

export interface ModoAutoteste {
  /** Número da própria conta conectada (sem sufixo). */
  telefoneProprio: string;
  /** Outros números com quem o bot pode conversar durante o teste. */
  numerosPermitidos: string[];
}

export interface WppConnectClientOptions {
  /** Nome da sessão, para identificar nos logs de qual número veio o evento. */
  sessao?: string;
  autoteste?: ModoAutoteste;
}

function paraChatId(telefone: string): string {
  return telefone.includes('@') ? telefone : `${telefone}@c.us`;
}

function ehRespostaDoBot(mensagem: Message): boolean {
  return [mensagem.body, mensagem.caption].some((texto) => texto?.startsWith(MARCADOR_BOT));
}

function ehConversaIndividual(chatId: string): boolean {
  return chatId.endsWith('@c.us') || chatId.endsWith('@lid');
}

/**
 * O tipo diz que `id` é string, mas mensagens enviadas pela própria conta
 * (vistas via onAnyMessage) podem chegar sem ele, ou com o objeto MsgKey.
 * Sem um id estável a idempotência não funciona, então montamos um a partir
 * de campos que não mudam numa reentrega.
 */
function idDaMensagem(mensagem: Message): { id: string; reserva: boolean } {
  const bruto: unknown = mensagem.id;
  if (typeof bruto === 'string' && bruto) {
    return { id: bruto, reserva: false };
  }
  if (bruto && typeof bruto === 'object') {
    const chave = bruto as { _serialized?: string; id?: string };
    const id = chave._serialized ?? chave.id;
    if (id) {
      return { id, reserva: false };
    }
  }
  const instante = mensagem.timestamp ?? mensagem.t;
  return { id: `reserva:${mensagem.from}:${mensagem.to}:${instante}:${trecho(mensagem.body ?? '', 40)}`, reserva: true };
}

const TIPOS_DE_MIDIA = new Set(['image', 'video', 'audio', 'ptt', 'sticker', 'document']);

/**
 * `isMedia` não vem preenchido em mensagens enviadas pela própria conta (vistas
 * via onAnyMessage) — sem isso a foto era tratada como texto e o `body` (a
 * miniatura em base64) virava a "mensagem". O `type` é confiável nos dois casos.
 */
function ehMidia(mensagem: Message): boolean {
  return mensagem.isMedia || TIPOS_DE_MIDIA.has(mensagem.type);
}

function ehImagem(mensagem: Message): boolean {
  return mensagem.type === 'image' || Boolean(mensagem.mimetype?.startsWith('image/'));
}

/** Descrição curta do conteúdo, sem despejar base64 de mídia no log. */
function resumoConteudo(mensagem: Message): string {
  if (ehMidia(mensagem)) {
    return mensagem.caption ? `[${mensagem.type}] ${trecho(mensagem.caption)}` : `[${mensagem.type}]`;
  }
  return trecho(mensagem.body ?? '');
}

/**
 * downloadMedia retorna uma data URI base64 (não uma URL http) — guardamos
 * isso mesmo em `imagemUrl`, já que o resto do domínio só usa o valor como
 * anexo opaco a ser reenviado, nunca busca a URL de fato.
 */
export function criarWppConnectClient(whatsapp: Whatsapp, options: WppConnectClientOptions = {}): WhatsAppClient {
  const { autoteste } = options;
  const logger = loggerRaiz.child({ sessao: options.sessao });
  const chavesPermitidas = new Set(
    autoteste ? [autoteste.telefoneProprio, ...autoteste.numerosPermitidos].map(chaveTelefone) : [],
  );

  // A própria conta aparece com dois IDs: `<telefone>@c.us` e `<n>@lid`. No
  // chat "você mesmo" o WhatsApp pode misturar os dois (ex.: de @c.us para
  // @lid), então o LID é descoberto uma vez e usado na comparação.
  let idsPropriosCache: Set<string> | undefined;

  async function idsProprios(telefoneProprio: string): Promise<Set<string>> {
    if (idsPropriosCache) {
      return idsPropriosCache;
    }
    const ids = new Set([paraChatId(telefoneProprio)]);
    try {
      const entrada = await whatsapp.getPnLidEntry(paraChatId(telefoneProprio));
      if (entrada.lid?._serialized) {
        ids.add(entrada.lid._serialized);
        // Só fica em cache quando o LID foi encontrado; senão tenta de novo na próxima mensagem.
        idsPropriosCache = ids;
      }
    } catch (erro) {
      logger.warn({ err: erro }, 'não foi possível descobrir o LID da conta conectada');
    }
    logger.info({ ids: [...ids] }, 'identificadores da conta conectada');
    return ids;
  }

  async function ehChatProprio(mensagem: Message, telefoneProprio: string): Promise<boolean> {
    if (!mensagem.fromMe) {
      return false;
    }
    if (mensagem.from === mensagem.to) {
      return true;
    }
    return (await idsProprios(telefoneProprio)).has(mensagem.to);
  }

  function destinoPermitido(telefone: string): boolean {
    if (!autoteste || chavesPermitidas.has(chaveTelefone(telefone))) {
      return true;
    }
    logger.warn({ destino: telefone }, '🚫 modo autoteste: envio para número não permitido bloqueado');
    return false;
  }

  function marcar(texto: string): string {
    return autoteste ? `${MARCADOR_BOT}${texto}` : texto;
  }

  /**
   * Contas novas chegam como `<id>@lid`, que não é o telefone; consultamos o
   * mapeamento LID → número para que respostas, filtros e o cadastro usem
   * sempre o telefone real.
   */
  async function resolverTelefone(chatId: string): Promise<string> {
    if (!chatId.endsWith('@lid')) {
      return telefoneDoChatId(chatId);
    }
    try {
      const entrada = await whatsapp.getPnLidEntry(chatId);
      if (entrada.phoneNumber?.id) {
        return entrada.phoneNumber.id;
      }
    } catch (erro) {
      logger.warn({ err: erro, chatId }, 'não foi possível converter @lid em telefone');
    }
    return chatId;
  }

  /** Telefone de quem escreveu, ou o motivo para ignorar a mensagem. */
  async function avaliarRemetente(mensagem: Message): Promise<{ telefone: string } | { motivo: string }> {
    if (ehMidia(mensagem) && !ehImagem(mensagem)) {
      return { motivo: `mídia não suportada (${mensagem.mimetype ?? mensagem.type})` };
    }
    if (!autoteste) {
      return { telefone: await resolverTelefone(mensagem.from) };
    }

    if (await ehChatProprio(mensagem, autoteste.telefoneProprio)) {
      return ehRespostaDoBot(mensagem)
        ? { motivo: 'é a própria resposta do bot' }
        : { telefone: autoteste.telefoneProprio };
    }
    if (mensagem.fromMe) {
      return { motivo: 'enviada por esta conta para outro chat' };
    }
    if (!ehConversaIndividual(mensagem.from)) {
      return { motivo: 'grupo, status ou canal' };
    }

    const telefone = await resolverTelefone(mensagem.from);
    if (!chavesPermitidas.has(chaveTelefone(telefone))) {
      return { motivo: `modo autoteste: ${telefone} não está em WPP_NUMEROS_PERMITIDOS` };
    }
    return { telefone };
  }

  return {
    async sendText(telefone, texto) {
      if (!destinoPermitido(telefone)) {
        return;
      }
      await whatsapp.sendText(paraChatId(telefone), marcar(texto));
      logger.info({ para: telefone, conteudo: trecho(texto) }, '🤖 BOT RESPONDEU');
    },

    async sendImage(telefone, imagemUrlOuBase64, legenda) {
      if (!destinoPermitido(telefone)) {
        return;
      }
      const legendaMarcada = marcar(legenda ?? '');
      if (imagemUrlOuBase64.startsWith('data:')) {
        await whatsapp.sendImageFromBase64(paraChatId(telefone), imagemUrlOuBase64, 'imagem.png', legendaMarcada);
      } else {
        await whatsapp.sendImage(paraChatId(telefone), imagemUrlOuBase64, 'imagem.png', legendaMarcada);
      }
      logger.info({ para: telefone, conteudo: `[imagem] ${legenda ? trecho(legenda) : ''}` }, '🤖 BOT RESPONDEU');
    },

    onMessage(manipulador: ManipuladorMensagem) {
      const tratar = async (mensagem: Message) => {
        // Uma linha por mensagem que passa pela sessão — recebida ou enviada —
        // com a decisão tomada, para dar para acompanhar o teste pelo terminal.
        const direcao = mensagem.fromMe ? '📤 ENVIADA ' : '📩 RECEBIDA';
        const resumo = { de: mensagem.from, para: mensagem.to, conteudo: resumoConteudo(mensagem) };

        if (mensagem.from === 'status@broadcast') {
          logger.debug(resumo, `${direcao} status do WhatsApp — ignorada`);
          return;
        }
        if (mensagem.fromMe && ehRespostaDoBot(mensagem)) {
          // Já registrada em sendText/sendImage; aqui é só o eco do envio.
          logger.debug(resumo, `${direcao} eco da resposta do bot — ignorada`);
          return;
        }

        const avaliacao = await avaliarRemetente(mensagem);
        if ('motivo' in avaliacao) {
          logger.info({ ...resumo, motivo: avaliacao.motivo }, `${direcao} 🙈 ignorada`);
          return;
        }

        logger.info({ ...resumo, telefone: avaliacao.telefone }, `${direcao} ✅ processando`);

        const { id: mensagemId, reserva } = idDaMensagem(mensagem);
        if (reserva) {
          logger.warn(
            { mensagemId, camposRecebidos: Object.keys(mensagem) },
            'mensagem chegou sem id; usando id de reserva',
          );
        }

        let imagemUrl: string | undefined;
        if (ehMidia(mensagem)) {
          try {
            imagemUrl = await whatsapp.downloadMedia(mensagem);
          } catch (erro) {
            logger.warn({ err: erro, mensagemId }, 'Falha ao baixar mídia recebida do WhatsApp');
          }
        }

        const mensagemRecebida: MensagemRecebida = {
          id: mensagemId,
          telefone: avaliacao.telefone,
          // Em mídia o `body` traz a miniatura em base64; o texto é a legenda.
          corpo: (ehMidia(mensagem) ? mensagem.caption : mensagem.body) ?? '',
          imagemUrl,
          timestamp: new Date(mensagem.timestamp * 1000),
        };

        try {
          await manipulador(mensagemRecebida);
        } catch (erro) {
          logger.error({ err: erro, mensagemId }, '💥 erro ao processar mensagem');
        }
      };

      const tratarComSeguranca = (mensagem: Message) =>
        tratar(mensagem).catch((erro: unknown) => {
          logger.error({ err: erro, mensagemId: idDaMensagem(mensagem).id }, '💥 erro ao avaliar mensagem');
        });

      // onMessage do WPPConnect descarta mensagens enviadas pela própria conta,
      // então no autoteste é preciso ouvir todas para enxergar o chat próprio.
      if (autoteste) {
        whatsapp.onAnyMessage(tratarComSeguranca);
      } else {
        whatsapp.onMessage(tratarComSeguranca);
      }
    },
  };
}
