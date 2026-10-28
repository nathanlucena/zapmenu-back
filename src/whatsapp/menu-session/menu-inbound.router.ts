import { processarMensagemGestao, type GestaoDeps, type RespostaGestao } from '../../menu/gestao/gestao.service.js';
import { ehOpcaoDaEnquete } from '../../menu/gestao/tipo-da-loja.js';
import { ehOpcaoDaFotoDaLoja } from '../../menu/gestao/foto-da-loja.js';
import type { IdempotencyRepository } from '../../shared/idempotency/idempotency.repository.js';
import { logger } from '../../shared/logger/logger.js';
import type { MensagemRecebida, WhatsAppClient } from '../whatsapp-client.interface.js';
import { ehComandoSemIA } from '../../menu/gestao/comandos.js';
import { criarAgrupador, type OpcoesAgrupamento } from './agrupador.js';
import { AUDIO_DESLIGADO, ouvirAudio, type OuvirAudioDeps } from '../../audio/application/ouvir-audio.js';
import { criarAvisoDeFalha } from '../falhas.js';
import { registrarVotosDaLoja, tratarRespostaDaLojaEmTexto, type DecisaoPedidoDeps } from './decisao-pedido.js';

const ORIGEM_IDEMPOTENCIA = 'whatsapp_menu';
const ORIGEM_VOTO_GESTAO = 'whatsapp_menu_voto';

export interface MenuInboundRouterDeps extends GestaoDeps {
  whatsapp: WhatsAppClient;
  idempotency: IdempotencyRepository;
  /** Aceite e recusa de pedidos pela loja (enquete ou "aceitar PED-XXXX"). Sem isso, só a conversa de gestão. */
  decisoes?: Omit<DecisaoPedidoDeps, 'idempotency'>;
  /**
   * Junta mensagens seguidas do mesmo telefone numa rodada só (ex.: 3 s de
   * silêncio, teto de 10 s). Sem isso, cada mensagem é uma rodada.
   */
  agrupamento?: OpcoesAgrupamento;
  /** Transcrição dos áudios do lojista (Profissional). Sem isso, pede para escrever. */
  audio?: OuvirAudioDeps;
}

/** Várias mensagens viram uma: os textos em linhas, a primeira foto junto; as outras fotos vão depois. */
function juntar(mensagens: MensagemRecebida[]): { principal: MensagemRecebida; fotosExtras: MensagemRecebida[] } {
  const comFoto = mensagens.filter((mensagem) => mensagem.imagemUrl);
  const texto = mensagens
    .map((mensagem) => mensagem.corpo.trim())
    .filter(Boolean)
    .join('\n');
  const ultima = mensagens[mensagens.length - 1]!;
  return {
    principal: { ...ultima, corpo: texto, imagemUrl: comFoto[0]?.imagemUrl },
    fotosExtras: comFoto.slice(1).map((mensagem) => ({ ...mensagem, corpo: '' })),
  };
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

  /** Uma rodada da gestão com uma ou mais mensagens; todas são marcadas como processadas juntas. */
  const processarRodada = async (mensagens: MensagemRecebida[]) => {
    const { principal, fotosExtras } = juntar(mensagens);
    try {
      const respostas = await processarMensagemGestao(
        { telefone: principal.telefone, texto: principal.corpo, imagemUrl: principal.imagemUrl },
        deps,
      );
      await enviarRespostas(deps.whatsapp, principal.telefone, respostas);
      // Mais de uma foto na mesma leva: cada uma a mais é uma rodada logo depois (na loja, vão para a mesma galeria).
      for (const foto of fotosExtras) {
        const extras = await processarMensagemGestao({ telefone: foto.telefone, texto: '', imagemUrl: foto.imagemUrl }, deps);
        await enviarRespostas(deps.whatsapp, foto.telefone, extras);
      }
      for (const mensagem of mensagens) {
        await deps.idempotency.marcarProcessado(ORIGEM_IDEMPOTENCIA, mensagem.id);
      }
    } catch (erro) {
      // Sem marcar como processadas: a reentrega (ou a pessoa mandando de novo) tenta outra vez.
      await avisarFalha(deps.whatsapp, principal.telefone, principal.id, erro);
    }
  };

  /**
   * Áudio vira texto antes de tudo ("🎤 Entendi: …") e segue como mensagem
   * escrita. Quando não dá (desligado, longo, sem cota, falhou), responde e
   * devolve undefined.
   */
  const comAudioTranscrito = async (mensagem: MensagemRecebida): Promise<MensagemRecebida | undefined> => {
    if (!mensagem.audio) {
      return mensagem;
    }
    try {
      await deps.whatsapp.sendTyping?.(mensagem.telefone).catch(() => undefined);
      const resultado = deps.audio
        ? await ouvirAudio(deps.audio, mensagem.telefone, mensagem.audio, 'LOJISTA')
        : { tipo: 'RESPOSTA' as const, texto: AUDIO_DESLIGADO };
      if (resultado.tipo === 'RESPOSTA') {
        await deps.whatsapp.sendText(mensagem.telefone, resultado.texto);
        await deps.idempotency.marcarProcessado(ORIGEM_IDEMPOTENCIA, mensagem.id);
        return undefined;
      }
      await deps.whatsapp.sendText(mensagem.telefone, `🎤 Entendi: “${resultado.texto}”`);
      return { ...mensagem, corpo: [mensagem.corpo, resultado.texto].filter(Boolean).join('\n'), audio: undefined };
    } catch (erro) {
      await avisarFalha(deps.whatsapp, mensagem.telefone, mensagem.id, erro);
      return undefined;
    }
  };

  const agrupador =
    deps.agrupamento &&
    criarAgrupador<MensagemRecebida>(deps.agrupamento, (telefone, mensagens) => {
      void enfileirar(telefone, () => processarRodada(mensagens));
    });

  deps.whatsapp.onMessage(async (recebida) => {
    if (await deps.idempotency.jaProcessado(ORIGEM_IDEMPOTENCIA, recebida.id)) {
      logger.info({ mensagemId: recebida.id }, 'mensagem de gestão já processada (reentrega), ignorando');
      return;
    }
    const mensagem = await comAudioTranscrito(recebida);
    if (!mensagem) {
      return;
    }
    // Aceite/recusa de pedido e comandos curtos sozinhos (sim, cancelar, o que falta…) respondem na hora.
    const agora =
      !agrupador ||
      /PED-/i.test(mensagem.corpo) ||
      (!agrupador.pendente(mensagem.telefone) && !mensagem.imagemUrl && ehComandoSemIA(mensagem.corpo));
    if (!agora) {
      agrupador.adicionar(mensagem.telefone, mensagem);
      await deps.whatsapp.sendTyping?.(mensagem.telefone).catch(() => undefined);
      return;
    }
    return enfileirar(mensagem.telefone, async () => {
      try {
        if (decisoes && (await tratarRespostaDaLojaEmTexto(decisoes, deps.whatsapp, mensagem))) {
          await deps.idempotency.marcarProcessado(ORIGEM_IDEMPOTENCIA, mensagem.id);
          return;
        }
      } catch (erro) {
        await avisarFalha(deps.whatsapp, mensagem.telefone, mensagem.id, erro);
        return;
      }
      await processarRodada([mensagem]);
    });
  });

  // Voto na enquete do tipo da loja: entra na conversa como se a pessoa tivesse escrito a opção.
  deps.whatsapp.onPollVote((voto) => {
    const opcao = voto.opcoes[0];
    if (!opcao || (!ehOpcaoDaEnquete(opcao) && !ehOpcaoDaFotoDaLoja(opcao))) {
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
