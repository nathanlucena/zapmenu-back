import { logger as loggerRaiz } from '../../shared/logger/logger.js';
import { podeUsar, type SituacaoDoPlano } from '../../planos/domain/assinatura.js';
import { fimDoDiaNoFuso } from '../../planos/domain/calendario.js';
import { mensagemRecursoDoPlano } from '../../planos/application/mensagens.js';
import { recursoDaPromocao, rotuloDaPromocao, type AlvoPromocao } from '../../promocoes/domain/promocao.js';
import {
  descreverPromocao,
  itensAfetados,
  listaDePromocoes,
  precisaDeConfirmacaoExtra,
  precoNaPromocao,
  problemasDaPromocao,
  resumoDaPromocao,
  type CatalogoParaPromocao,
} from '../../promocoes/application/promocoes.js';
import type { MensageiroPromocoes } from '../../promocoes/application/ports/avisos-promocao.js';
import type { NovaPromocao, PromocoesRepository } from '../../promocoes/application/ports/promocoes.repository.js';
import type { Contexto } from '../conversation/conversation-state.types.js';
import { reconhecerComando, reconhecerComandoDePromocao } from './comandos.js';
import type { SnapshotCardapio } from './gestao.repository.js';
import type { PromocaoProposta } from './interpretador.js';
import { MAX_ITENS_NA_PREVIA, type Previa, type PreviasRepository } from './previa.js';

const logger = loggerRaiz.child({ modulo: 'gestao-promocoes' });

export interface PromocoesDeps {
  repo: PromocoesRepository;
  mensageiro: MensageiroPromocoes;
}

/** Texto ou a imagem da prévia (o mesmo formato das respostas da gestão). */
export type RespostaDaPromocao = string | { imagemUrl: string; legenda: string };

export interface ConversaDasPromocoes {
  promocoes: PromocoesDeps;
  telefone: string;
  texto: string;
  contexto: Contexto;
  snapshot: SnapshotCardapio;
  /** Ausente: planos desligados (tudo liberado). */
  plano?: SituacaoDoPlano;
  linkDosPlanos?: string;
  /** Prévia em imagem, quando a loja tem o recurso. */
  previas?: { repo: PreviasRepository; urlDaImagem: (id: string) => string };
  agora?: Date;
}

const FUSO_PADRAO = 'America/Sao_Paulo';
const VALIDADE_PREVIA_MS = 60 * 60_000;

function catalogoDo(snapshot: SnapshotCardapio): CatalogoParaPromocao {
  return {
    itens: snapshot.itens.map((item) => ({ id: item.id, nome: item.nome, precoBase: item.precoBase, categoriaId: item.categoriaId })),
    categorias: snapshot.categorias,
  };
}

/** A loja tem pelo menos um dos recursos de promoção. */
function temPromocoes(plano?: SituacaoDoPlano): boolean {
  return !plano || podeUsar(plano, 'PROMOCOES') || podeUsar(plano, 'DESCONTO_PERCENTUAL');
}

function paraNova(pendente: NonNullable<Contexto['promocaoPendente']>): NovaPromocao {
  return {
    tipo: pendente.tipo,
    valor: pendente.valor,
    alvo: pendente.alvo as AlvoPromocao,
    diasSemana: pendente.diasSemana,
    horaInicio: pendente.horaInicio,
    horaFim: pendente.horaFim,
    fim: pendente.fim ? new Date(pendente.fim) : undefined,
  };
}

/** Prévia com o preço riscado nos itens afetados (até o máximo da imagem). */
async function previaDaPromocao(conversa: ConversaDasPromocoes, nova: NovaPromocao): Promise<RespostaDaPromocao[]> {
  const { previas } = conversa;
  if (!previas) {
    return [];
  }
  const afetados = itensAfetados(nova.alvo, catalogoDo(conversa.snapshot));
  const previa: Previa = {
    loja: { nome: conversa.snapshot.loja.nome, corDestaque: conversa.snapshot.loja.corDestaque, alterada: false },
    itens: afetados.slice(0, MAX_ITENS_NA_PREVIA).map((afetado) => {
      const item = conversa.snapshot.itens.find((candidato) => candidato.id === afetado.id);
      return {
        nome: afetado.nome,
        descricao: item?.descricao,
        precoBase: afetado.precoBase,
        precoPromocional: precoNaPromocao(afetado.precoBase, nova),
        selo: rotuloDaPromocao(nova),
        imagemUrl: item?.imagemUrl,
        variacoes: [],
        marca: 'PROMOCAO',
      };
    }),
    itensOcultos: Math.max(0, afetados.length - MAX_ITENS_NA_PREVIA),
  };
  try {
    const id = await previas.repo.guardar(previa, VALIDADE_PREVIA_MS);
    return [{ imagemUrl: previas.urlDaImagem(id), legenda: 'Assim a promoção aparece no cardápio 👇' }];
  } catch (erro) {
    logger.warn({ err: erro }, 'não foi possível guardar a prévia da promoção; vai só o resumo');
    return [];
  }
}

/**
 * A IA propôs uma promoção: valida, guarda como pendente e mostra o resumo
 * (com a prévia, se houver). Nada é gravado antes do "sim".
 */
export async function proporPromocao(conversa: ConversaDasPromocoes, proposta: PromocaoProposta): Promise<RespostaDaPromocao[]> {
  const loja = await conversa.promocoes.repo.lojaDe(conversa.telefone);
  if (!loja) {
    return ['Para criar promoções, primeiro termine o cadastro da loja. 🙂'];
  }
  const agora = conversa.agora ?? new Date();
  const nova: NovaPromocao = {
    tipo: proposta.tipo,
    valor: proposta.valor,
    alvo: proposta.alvo,
    diasSemana: [...new Set(proposta.diasSemana)].sort((a, b) => a - b),
    horaInicio: proposta.horaInicio,
    horaFim: proposta.horaFim,
    fim: proposta.ate ? fimDoDiaNoFuso(proposta.ate, loja.fuso) : undefined,
  };
  const catalogo = catalogoDo(conversa.snapshot);
  const problemas = problemasDaPromocao(nova, catalogo, agora);
  if (problemas.length > 0) {
    return [`Não consegui montar a promoção: ${problemas.join('; ')}. Pode me dizer de novo?`];
  }
  conversa.contexto.promocaoPendente = {
    ...nova,
    alvo: nova.alvo,
    fim: nova.fim?.toISOString(),
    confirmacoes: 0,
  };
  return [...(await previaDaPromocao(conversa, nova)), resumoDaPromocao(nova, catalogo, loja.fuso)];
}

/** "sim"/"não" para a promoção mostrada; o "sim" de desconto alto vale duas vezes. */
async function responderPromocaoPendente(
  conversa: ConversaDasPromocoes,
  pendente: NonNullable<Contexto['promocaoPendente']>,
): Promise<RespostaDaPromocao[] | undefined> {
  const resposta = reconhecerComando(conversa.texto);
  if (resposta === 'NAO' || resposta === 'CANCELAR') {
    conversa.contexto.promocaoPendente = undefined;
    return ['Ok, descartei a promoção. Nada mudou nos preços.'];
  }
  if (resposta !== 'SIM') {
    // Outra mensagem (ex.: "muda para 35"): a IA pode propor de novo; a pendente sai.
    conversa.contexto.promocaoPendente = undefined;
    return undefined;
  }
  const nova = paraNova(pendente);
  if (precisaDeConfirmacaoExtra(nova) && pendente.confirmacoes < 1) {
    conversa.contexto.promocaoPendente = { ...pendente, confirmacoes: 1 };
    return [`⚠️ Tem certeza? São *${nova.valor}% de desconto*: os preços caem para menos da metade. Responda *sim* de novo para criar, ou *não*.`];
  }
  conversa.contexto.promocaoPendente = undefined;
  const loja = await conversa.promocoes.repo.lojaDe(conversa.telefone);
  if (!loja) {
    return ['Não achei a sua loja para salvar a promoção.'];
  }
  await conversa.promocoes.repo.criar(loja.lojaId, nova);
  logger.info({ telefone: conversa.telefone, tipo: nova.tipo, valor: nova.valor }, '🏷️ promoção criada');
  return [
    `✅ Promoção criada: ${descreverPromocao(nova, catalogoDo(conversa.snapshot), loja.fuso)}.\nPara ver ou pausar, mande *minhas promoções*.`,
  ];
}

/**
 * "minhas promoções", "pausar/reativar/remover promoção N" e a confirmação de
 * uma promoção mostrada. Tudo sem IA. undefined = a mensagem não é sobre promoções.
 */
export async function conversaDasPromocoes(conversa: ConversaDasPromocoes): Promise<RespostaDaPromocao[] | undefined> {
  const comando = reconhecerComandoDePromocao(conversa.texto);
  const pendente = conversa.contexto.promocaoPendente;
  if (pendente && !comando) {
    return responderPromocaoPendente(conversa, pendente);
  }
  if (!comando) {
    return undefined;
  }
  conversa.contexto.promocaoPendente = undefined;
  if (!temPromocoes(conversa.plano)) {
    return [mensagemRecursoDoPlano('PROMOCOES', conversa.linkDosPlanos)];
  }
  const loja = await conversa.promocoes.repo.lojaDe(conversa.telefone);
  if (!loja) {
    return ['Você ainda não tem promoções. Termine o cadastro da loja e depois é só me dizer a promoção. 🙂'];
  }
  const agora = conversa.agora ?? new Date();
  const promocoes = await conversa.promocoes.repo.listar(loja.lojaId);
  const catalogo = catalogoDo(conversa.snapshot);
  if (comando.tipo === 'LISTAR') {
    return [listaDePromocoes(promocoes, catalogo, agora, loja.fuso ?? FUSO_PADRAO)];
  }
  const promocao = promocoes[comando.numero - 1];
  if (!promocao) {
    return [`Não achei a promoção ${comando.numero}. Mande *minhas promoções* para ver a lista.`];
  }
  const descricao = descreverPromocao(promocao, catalogo, loja.fuso);
  switch (comando.tipo) {
    case 'PAUSAR':
      await conversa.promocoes.repo.definirAtiva(loja.lojaId, promocao.id, false);
      return [`⏸️ Promoção pausada: ${descricao}. Para voltar, mande *reativar promoção ${comando.numero}*.`];
    case 'REATIVAR':
      if (!podeUsar(conversa.plano, recursoDaPromocao(promocao.tipo))) {
        return [mensagemRecursoDoPlano(recursoDaPromocao(promocao.tipo), conversa.linkDosPlanos)];
      }
      await conversa.promocoes.repo.definirAtiva(loja.lojaId, promocao.id, true);
      return [`▶️ Promoção reativada: ${descricao}.`];
    case 'REMOVER':
      await conversa.promocoes.repo.remover(loja.lojaId, promocao.id);
      return [`🗑️ Promoção removida: ${descricao}. Os preços dos itens não mudaram.`];
  }
}
