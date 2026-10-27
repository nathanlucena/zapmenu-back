import { logger as loggerRaiz } from '../../shared/logger/logger.js';
import { podeUsar, type SituacaoDoPlano } from '../../planos/domain/assinatura.js';
import { conferirCota, registrarUsoDaCota } from '../../planos/application/cotas.js';
import { mensagemRecursoDoPlano } from '../../planos/application/mensagens.js';
import type { AssinaturasRepository } from '../../planos/application/ports/assinaturas.repository.js';
import { rascunhoVazio, type Contexto } from '../conversation/conversation-state.types.js';
import { normalizar, reconhecerComando, reconhecerComandoDeDescricao } from './comandos.js';
import { caberNaDescricao, type GeradorDeDescricoes } from './gerador-de-descricoes.js';
import type { GestaoRepository, ItemSnapshot, SnapshotCardapio } from './gestao.repository.js';

const logger = loggerRaiz.child({ modulo: 'gestao-descricoes' });

export interface DescricoesDeps {
  gerador: GeradorDeDescricoes;
  cotas: Pick<AssinaturasRepository, 'obterOuIniciarTeste' | 'usoDaCota' | 'somarUsoDaCota'>;
}

export interface ConversaDasDescricoes {
  descricoes: DescricoesDeps;
  gestaoRepo: Pick<GestaoRepository, 'salvarRascunho'>;
  /** Telefone do dono: identifica a loja e a cota. */
  telefone: string;
  texto: string;
  contexto: Contexto;
  snapshot: SnapshotCardapio;
  /** Ausente: planos desligados (tudo liberado). */
  plano?: SituacaoDoPlano;
  linkDosPlanos?: string;
}

/** Itens por pedido de categoria. */
export const MAX_DESCRICOES_POR_VEZ = 10;
/** Descrição menor que isso merece a oferta da IA. */
export const DESCRICAO_CURTA = 40;

/** O que a loja já disse do item, para a IA não inventar o resto. */
function detalhesDo(item: ItemSnapshot): string[] {
  return [
    ...item.variacoes.map((variacao) => `${variacao.nome}: ${variacao.opcoes.map((opcao) => opcao.nome).join(', ')}`),
    ...(item.grade ?? []).map((linha) => [linha.tamanho, linha.cor].filter(Boolean).join(' ')).filter(Boolean),
  ];
}

/** Gera as 2 opções do próximo item da fila (cada item gasta 1 da cota) e guarda a escolha pendente. */
async function proximaSugestao(conversa: ConversaDasDescricoes, fila: string[]): Promise<string[]> {
  const restantes = [...fila];
  while (restantes.length > 0) {
    const itemId = restantes.shift()!;
    const item = conversa.snapshot.itens.find((candidato) => candidato.id === itemId);
    if (!item) continue;

    const cota = await conferirCota(conversa.descricoes.cotas, conversa.telefone, 'IA_DESCRICAO', 'sugestoesIaMes', 1);
    if (!cota.ok) {
      conversa.contexto.descricoes = undefined;
      return [
        cota.motivo === 'COTA_ESGOTADA'
          ? 'As sugestões de descrição do seu plano neste mês acabaram. Você pode escrever a descrição normalmente, é só me dizer.'
          : mensagemRecursoDoPlano('IA_DESCRICAO', conversa.linkDosPlanos),
      ];
    }
    let opcoes: [string, string];
    try {
      opcoes = await conversa.descricoes.gerador.sugerir({
        nome: item.nome,
        descricaoAtual: item.descricao,
        categoria: item.categoriaNome,
        detalhes: detalhesDo(item),
        segmento: conversa.snapshot.segmento,
      });
    } catch (erro) {
      logger.warn({ err: erro }, 'falha ao gerar as descrições');
      conversa.contexto.descricoes = undefined;
      return ['Não consegui escrever as descrições agora 😕 Tente de novo em instantes.'];
    }
    await registrarUsoDaCota(conversa.descricoes.cotas, cota, 'sugestoesIaMes', 1);
    conversa.contexto.descricoes = { etapa: 'ESCOLHA', fila: restantes, atual: { itemId, nome: item.nome, opcoes } };
    const faltam = restantes.length > 0 ? `\n_(depois dele, mais ${restantes.length})_` : '';
    return [
      `✍️ *${item.nome}* — escolha uma descrição:\n1. ${opcoes[0]}\n2. ${opcoes[1]}\n\nResponda *1*, *2*, escreva a sua, ou *pular*.${faltam}`,
    ];
  }
  conversa.contexto.descricoes = undefined;
  return ['Pronto, terminei as descrições. ✨'];
}

async function salvarDescricao(conversa: ConversaDasDescricoes, itemId: string, descricao: string): Promise<void> {
  await conversa.gestaoRepo.salvarRascunho(conversa.telefone, { ...rascunhoVazio(), edicoes: [{ itemId, descricao }] });
  logger.info({ telefone: conversa.telefone, itemId }, '✍️ descrição salva');
}

/** A resposta da pessoa à oferta ou à escolha. undefined = mensagem sobre outra coisa (a etapa é deixada de lado). */
async function continuar(
  conversa: ConversaDasDescricoes,
  pendente: NonNullable<Contexto['descricoes']>,
): Promise<string[] | undefined> {
  const texto = conversa.texto.trim();
  const comando = reconhecerComando(texto);
  if (comando === 'CANCELAR' || (pendente.etapa === 'OFERTA' && comando === 'NAO')) {
    conversa.contexto.descricoes = undefined;
    return ['Ok, sem descrições por agora. Quando quiser, mande _melhora a descrição da …_.'];
  }
  if (pendente.etapa === 'OFERTA') {
    if (comando === 'SIM') return proximaSugestao(conversa, pendente.itemIds);
    conversa.contexto.descricoes = undefined;
    return undefined;
  }

  const { atual, fila } = pendente;
  const normalizado = normalizar(texto);
  if (normalizado === 'pular' || normalizado === 'proximo') {
    return proximaSugestao(conversa, fila);
  }
  const escolhida = normalizado === '1' ? atual.opcoes[0] : normalizado === '2' ? atual.opcoes[1] : undefined;
  // Texto que não é 1/2 nem um comando: é a descrição que a própria pessoa escreveu.
  const propria = !escolhida && !comando && texto.length >= 3 ? caberNaDescricao(texto) : undefined;
  const descricao = escolhida ?? propria;
  if (!descricao) {
    return ['Responda *1* ou *2*, escreva a sua descrição, ou mande *pular*.'];
  }
  await salvarDescricao(conversa, atual.itemId, descricao);
  const seguinte = fila.length > 0 ? await proximaSugestao(conversa, fila) : ((conversa.contexto.descricoes = undefined), []);
  return [`✅ Descrição de *${atual.nome}* salva.`, ...seguinte];
}

/** Item pelo nome (ignorando acentos e maiúsculas): exato primeiro, depois o que contém. */
function itemPeloNome(itens: ItemSnapshot[], nome: string): ItemSnapshot | undefined {
  const procurado = normalizar(nome);
  return itens.find((item) => normalizar(item.nome) === procurado) ?? itens.find((item) => normalizar(item.nome).includes(procurado));
}

/**
 * "melhora a descrição da X", "melhora as descrições da categoria Y" e as
 * respostas à oferta e às opções. Nada é salvo sem a pessoa escolher.
 */
export async function conversaDasDescricoes(conversa: ConversaDasDescricoes): Promise<string[] | undefined> {
  const comando = reconhecerComandoDeDescricao(conversa.texto);
  const pendente = conversa.contexto.descricoes;
  if (pendente && !comando) {
    return continuar(conversa, pendente);
  }
  if (!comando) {
    return undefined;
  }
  conversa.contexto.descricoes = undefined;
  if (conversa.plano && !podeUsar(conversa.plano, 'IA_DESCRICAO')) {
    return [mensagemRecursoDoPlano('IA_DESCRICAO', conversa.linkDosPlanos)];
  }
  if (comando.tipo === 'ITEM') {
    const item = itemPeloNome(conversa.snapshot.itens, comando.nome);
    return item ? proximaSugestao(conversa, [item.id]) : [`Não achei "${comando.nome}" no cardápio. Confere o nome?`];
  }
  const procurada = normalizar(comando.nome);
  const categoria = conversa.snapshot.categorias.find((candidata) => normalizar(candidata.nome) === procurada);
  if (!categoria) {
    return [`Não achei a categoria "${comando.nome}".`];
  }
  const itens = conversa.snapshot.itens.filter((item) => item.categoriaId === categoria.id);
  if (itens.length === 0) {
    return [`A categoria *${categoria.nome}* ainda não tem itens.`];
  }
  const aviso = itens.length > MAX_DESCRICOES_POR_VEZ ? [`Vou fazer os ${MAX_DESCRICOES_POR_VEZ} primeiros de *${categoria.nome}* (é o máximo por vez).`] : [];
  return [...aviso, ...(await proximaSugestao(conversa, itens.slice(0, MAX_DESCRICOES_POR_VEZ).map((item) => item.id)))];
}

/** Depois de salvar itens novos sem descrição boa: guarda a oferta e devolve a pergunta. */
export function oferecerDescricoes(contexto: Contexto, itens: ItemSnapshot[]): string | undefined {
  const semDescricao = itens.filter((item) => (item.descricao?.trim().length ?? 0) < DESCRICAO_CURTA).slice(0, MAX_DESCRICOES_POR_VEZ);
  if (semDescricao.length === 0) {
    return undefined;
  }
  contexto.descricoes = { etapa: 'OFERTA', itemIds: semDescricao.map((item) => item.id) };
  const para = semDescricao.length === 1 ? `*${semDescricao[0]!.nome}*` : `os ${semDescricao.length} itens novos`;
  return `✍️ Quer que eu escreva uma descrição para ${para}? (*sim*/*não*)`;
}
