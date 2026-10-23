import { processarMensagemGestao, type GestaoDeps, type RespostaGestao } from '../../menu/gestao/gestao.service.js';
import { ehOpcaoDaEnquete } from '../../menu/gestao/tipo-da-loja.js';
import type { IdempotencyRepository } from '../../shared/idempotency/idempotency.repository.js';
import { logger } from '../../shared/logger/logger.js';
import type { WhatsAppClient } from '../whatsapp-client.interface.js';
import { criarAvisoDeFalha } from '../falhas.js';
import { registrarVotosDaLoja, tratarRespostaDaLojaEmTexto, type DecisaoPedidoDeps } from './decisao-pedido.js';

const ORIGEM_IDEMPOTENCIA = 'whatsapp_menu';
const ORIGEM_VOTO_GESTAO = 'whatsapp_menu_voto';

export interface MenuInboundRouterDeps extends GestaoDeps {
  whatsapp: WhatsAppClient;
  idempotency: IdempotencyRepository;
  /** Aceite e recusa de pedidos pela loja (enquete ou "aceitar PED-XXXX"). Sem isso, só a conversa de gestão. */
  decisoes?: Omit<DecisaoPedidoDeps, 'idempotency'>;
}

/**
 * Mensagens do mesmo telefone são processadas uma de cada vez: cada uma lê o
 * estado da conversa, espera a IA e grava o estado de volta — em paralelo, a
 * última a terminar apagaria o que a outra fez.
 */
function criarFilaPorTelefone() {
  const filas = new Map<string, Promise<void>>();
  return (telefone: string, tarefa: () => Promise<void>): Promise<void> => {
    const anterior = filas.get(telefone) ?? Promise.resolve();
    const atual = anterior.then(tarefa, tarefa);
    const registrada = atual.catch(() => undefined);
    filas.set(telefone, registrada);
    void registrada.then(() => {
      if (filas.get(telefone) === registrada) {
        filas.delete(telefone);
      }
    });
    return atual;
  };
}

/** Quanto esperar a imagem da prévia (o front desenha, o WhatsApp baixa) antes de seguir só com o texto. */
const TEMPO_MAXIMO_IMAGEM_MS = 8_000;

/** A prévia é um extra: se demorar ou falhar, segue com o resumo em texto. */
async function enviarImagemSemTravar(whatsapp: WhatsAppClient, telefone: string, url: string, legenda: string) {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      whatsapp.sendImage(telefone, url, legenda),
      new Promise((_, rejeitar) => {
        timer = setTimeout(() => rejeitar(new Error('tempo esgotado')), TEMPO_MAXIMO_IMAGEM_MS);
      }),
    ]);
  } catch (erro) {
    logger.warn({ err: erro, url }, 'prévia em imagem não foi enviada; segue só o texto');
  } finally {
    clearTimeout(timer);
  }
}

export function registrarMenuInboundRouter(deps: MenuInboundRouterDeps): void {
  const enfileirar = criarFilaPorTelefone();
  const decisoes = deps.decisoes && { ...deps.decisoes, idempotency: deps.idempotency };
  if (decisoes) {
    registrarVotosDaLoja(decisoes, deps.whatsapp);
  }

  const avisarFalha = criarAvisoDeFalha('mensagem de gestão');

  deps.whatsapp.onMessage((mensagem) => enfileirar(mensagem.telefone, async () => {
    try {
      if (await deps.idempotency.jaProcessado(ORIGEM_IDEMPOTENCIA, mensagem.id)) {
        logger.info({ mensagemId: mensagem.id }, 'mensagem de gestão já processada (reentrega), ignorando');
        return;
      }

      if (decisoes && (await tratarRespostaDaLojaEmTexto(decisoes, deps.whatsapp, mensagem))) {
        await deps.idempotency.marcarProcessado(ORIGEM_IDEMPOTENCIA, mensagem.id);
        return;
      }

      const respostas = await processarMensagemGestao(
        { telefone: mensagem.telefone, texto: mensagem.corpo, imagemUrl: mensagem.imagemUrl },
        deps,
      );
      await enviarRespostas(deps.whatsapp, mensagem.telefone, respostas);
      await deps.idempotency.marcarProcessado(ORIGEM_IDEMPOTENCIA, mensagem.id);
    } catch (erro) {
      // Sem marcar como processada: a reentrega (ou a pessoa mandando de novo) tenta outra vez.
      await avisarFalha(deps.whatsapp, mensagem.telefone, mensagem.id, erro);
    }
  }));

  // Voto na enquete do tipo da loja: entra na conversa como se a pessoa tivesse escrito a opção.
  deps.whatsapp.onPollVote((voto) => {
    const opcao = voto.opcoes[0];
    if (!opcao || !ehOpcaoDaEnquete(opcao)) {
      return;
    }
    return enfileirar(voto.telefone, async () => {
      try {
        if (await deps.idempotency.jaProcessado(ORIGEM_VOTO_GESTAO, voto.id)) {
          return;
        }
        const respostas = await processarMensagemGestao({ telefone: voto.telefone, texto: opcao }, deps);
        await enviarRespostas(deps.whatsapp, voto.telefone, respostas);
        await deps.idempotency.marcarProcessado(ORIGEM_VOTO_GESTAO, voto.id);
      } catch (erro) {
        await avisarFalha(deps.whatsapp, voto.telefone, voto.id, erro);
      }
    });
  });
}

async function enviarRespostas(whatsapp: WhatsAppClient, telefone: string, respostas: RespostaGestao[]): Promise<void> {
  for (const resposta of respostas) {
    if (typeof resposta === 'string') {
      await whatsapp.sendText(telefone, resposta);
    } else if ('enquete' in resposta) {
      // Sem enquete (falhou ou o cliente não manda), o texto anterior já explica como responder.
      await whatsapp.sendPoll(telefone, resposta.enquete.pergunta, resposta.enquete.opcoes).catch((erro: unknown) => {
        logger.warn({ err: erro }, 'enquete da gestão não foi enviada; segue o texto');
      });
    } else {
      await enviarImagemSemTravar(whatsapp, telefone, resposta.imagemUrl, resposta.legenda);
    }
  }
}
