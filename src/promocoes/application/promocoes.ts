import { logger } from '../../shared/logger/logger.js';
import { diaEMes, diaNoFuso, inicioDoDiaNoFuso } from '../../planos/domain/calendario.js';
import {
  aplicarPromocao,
  descreverDias,
  PERCENTUAL_COM_CONFIRMACAO_EXTRA,
  PERCENTUAL_MAXIMO,
  PERCENTUAL_MINIMO,
  promocaoAlcanca,
  promocaoValeAgora,
  venceu,
  type AlvoPromocao,
  type Promocao,
} from '../domain/promocao.js';
import type { MensageiroPromocoes } from './ports/avisos-promocao.js';
import type { NovaPromocao, PromocoesRepository } from './ports/promocoes.repository.js';

/** O cardápio como a promoção precisa: nomes, preços e categorias. */
export interface CatalogoParaPromocao {
  itens: { id: string; nome: string; precoBase: number; categoriaId?: string }[];
  categorias: { id: string; nome: string }[];
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function reais(valor: number): string {
  return `R$ ${valor.toFixed(2).replace('.', ',')}`;
}

/** "18:00" → "18h"; "18:30" → "18h30". */
function hora(hhmm: string): string {
  const [h, m] = hhmm.split(':');
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`;
}

export function itensAfetados(alvo: AlvoPromocao, catalogo: CatalogoParaPromocao) {
  return catalogo.itens.filter((item) => promocaoAlcanca({ alvo }, item));
}

/** Motivos para recusar a promoção; vazio = pode mostrar o resumo. */
export function problemasDaPromocao(nova: NovaPromocao, catalogo: CatalogoParaPromocao, agora: Date): string[] {
  const problemas: string[] = [];
  if (nova.tipo === 'PERCENTUAL') {
    if (!Number.isFinite(nova.valor) || nova.valor < PERCENTUAL_MINIMO || nova.valor > PERCENTUAL_MAXIMO) {
      problemas.push(`o desconto precisa ser de ${PERCENTUAL_MINIMO}% a ${PERCENTUAL_MAXIMO}%`);
    }
  } else {
    if (nova.alvo.tipo !== 'ITENS') {
      problemas.push('preço fixo vale para itens: me diga quais (para a loja toda ou uma categoria, use um desconto em %)');
    }
    if (!Number.isFinite(nova.valor) || nova.valor <= 0) {
      problemas.push('o preço da promoção precisa ser maior que zero');
    }
  }
  const afetados = itensAfetados(nova.alvo, catalogo);
  if (afetados.length === 0) {
    problemas.push('não achei nenhum item para essa promoção');
  } else if (nova.tipo === 'PRECO_FIXO') {
    const semDesconto = afetados.filter((item) => nova.valor >= item.precoBase);
    if (semDesconto.length > 0) {
      problemas.push(
        `${semDesconto.map((item) => `*${item.nome}* custa ${reais(item.precoBase)}`).join(', ')}: o preço da promoção precisa ser menor`,
      );
    }
  }
  if ((nova.horaInicio && !HORA.test(nova.horaInicio)) || (nova.horaFim && !HORA.test(nova.horaFim))) {
    problemas.push('o horário precisa ser no formato 18:00');
  }
  if (Boolean(nova.horaInicio) !== Boolean(nova.horaFim)) {
    problemas.push('me diga o horário de começo e de fim');
  }
  if (nova.diasSemana.some((dia) => !Number.isInteger(dia) || dia < 0 || dia > 6)) {
    problemas.push('não entendi os dias da semana');
  }
  if (nova.fim && nova.fim <= agora) {
    problemas.push('a data de fim já passou');
  }
  return problemas;
}

function descreverAlvo(promocao: Pick<Promocao, 'alvo'>, catalogo: CatalogoParaPromocao): string {
  switch (promocao.alvo.tipo) {
    case 'LOJA':
      return 'a loja toda';
    case 'CATEGORIAS': {
      const ids = promocao.alvo.ids;
      return catalogo.categorias.filter((categoria) => ids.includes(categoria.id)).map((categoria) => categoria.nome).join(', ');
    }
    case 'ITENS': {
      const ids = promocao.alvo.ids;
      const nomes = catalogo.itens.filter((item) => ids.includes(item.id)).map((item) => item.nome);
      return nomes.length > 3 ? `${nomes.slice(0, 3).join(', ')} e mais ${nomes.length - 3}` : nomes.join(', ');
    }
  }
}

/** "Calabresa por R$ 39,90 · quarta e quinta · 18h às 23h · até 30/11". */
export function descreverPromocao(
  promocao: Pick<Promocao, 'tipo' | 'valor' | 'alvo' | 'diasSemana' | 'horaInicio' | 'horaFim' | 'fim'>,
  catalogo: CatalogoParaPromocao,
  fuso: string,
): string {
  const oQue =
    promocao.tipo === 'PRECO_FIXO'
      ? `${descreverAlvo(promocao, catalogo)} por ${reais(promocao.valor)}`
      : `${promocao.valor}% de desconto em ${descreverAlvo(promocao, catalogo)}`;
  return [
    oQue,
    descreverDias(promocao.diasSemana),
    ...(promocao.horaInicio && promocao.horaFim ? [`${hora(promocao.horaInicio)} às ${hora(promocao.horaFim)}`] : []),
    ...(promocao.fim ? [`até ${diaEMes(promocao.fim, fuso)}`] : []),
  ].join(' · ');
}

/** O preço com a promoção, para os exemplos do resumo e da prévia. */
export function precoNaPromocao(preco: number, promocao: Pick<Promocao, 'tipo' | 'valor'>): number {
  return Math.min(preco, aplicarPromocao(preco, promocao));
}

export function precisaDeConfirmacaoExtra(promocao: Pick<Promocao, 'tipo' | 'valor'>): boolean {
  return promocao.tipo === 'PERCENTUAL' && promocao.valor > PERCENTUAL_COM_CONFIRMACAO_EXTRA;
}

/** Resumo antes do "sim": o que é, quantos itens pega e 2 ou 3 exemplos de preço. */
export function resumoDaPromocao(nova: NovaPromocao, catalogo: CatalogoParaPromocao, fuso: string): string {
  const afetados = itensAfetados(nova.alvo, catalogo);
  const exemplos = afetados
    .slice(0, 3)
    .map((item) => `• ${item.nome}: ~${reais(item.precoBase)}~ → *${reais(precoNaPromocao(item.precoBase, nova))}*`);
  return [
    '🏷️ *Nova promoção*',
    descreverPromocao(nova, catalogo, fuso),
    '',
    `${afetados.length === 1 ? '1 item' : `${afetados.length} itens`} com desconto:`,
    ...exemplos,
    ...(afetados.length > 3 ? [`• … e mais ${afetados.length - 3}`] : []),
    '',
    'O preço normal dos itens não muda: fora dos dias e horários da promoção, vale o de sempre.',
    ...(precisaDeConfirmacaoExtra(nova) ? [`⚠️ É um desconto alto (${nova.valor}%): vou pedir para confirmar duas vezes.`] : []),
    'Confirma? (*sim*/*não*)',
  ].join('\n');
}

/** "minhas promoções": numeradas, com a situação de cada uma. */
export function listaDePromocoes(promocoes: Promocao[], catalogo: CatalogoParaPromocao, agora: Date, fuso: string): string {
  if (promocoes.length === 0) {
    return 'Você ainda não tem promoções. Para criar, é só me dizer, por exemplo: _toda quarta a calabresa sai por 39,90_ ou _10% em todas as pizzas até domingo_.';
  }
  const situacao = (promocao: Promocao) =>
    venceu(promocao, agora)
      ? '⌛ encerrada'
      : !promocao.ativa
        ? '⏸️ pausada'
        : promocaoValeAgora(promocao, agora, fuso)
          ? '✅ valendo agora'
          : '🕒 programada';
  return [
    '🏷️ *Suas promoções*',
    ...promocoes.map((promocao, indice) => `${indice + 1}. ${descreverPromocao(promocao, catalogo, fuso)} — ${situacao(promocao)}`),
    '',
    'Para mexer, mande _pausar promoção 1_, _reativar promoção 1_ ou _remover promoção 1_.',
  ].join('\n');
}

/** O aviso do fim sai no dia seguinte ao fim, a partir das 8h no fuso da loja. */
const HORA_DO_AVISO_DE_FIM = 8;

function avisoDoFimJaPode(fim: Date, agora: Date, fuso: string): boolean {
  const diaDoFim = diaNoFuso(fim, fuso);
  const [ano = 0, mes = 1, dia = 1] = diaDoFim.split('-').map(Number);
  const seguinte = new Date(Date.UTC(ano, mes - 1, dia + 1)).toISOString().slice(0, 10);
  return agora.getTime() >= inicioDoDiaNoFuso(seguinte, fuso).getTime() + HORA_DO_AVISO_DE_FIM * 3_600_000;
}

/**
 * Job: desliga as promoções vencidas e, no dia seguinte ao fim (8h), avisa o
 * lojista uma vez. Uma loja com erro não para as outras.
 */
export async function verificarPromocoesVencidas(
  deps: { repo: PromocoesRepository; mensageiro: MensageiroPromocoes },
  agora: Date = new Date(),
): Promise<void> {
  for (const { loja, promocao } of await deps.repo.listarVencidas(agora)) {
    try {
      if (promocao.ativa) {
        await deps.repo.definirAtiva(loja.lojaId, promocao.id, false);
      }
      if (promocao.avisoFimEm || !promocao.fim || !avisoDoFimJaPode(promocao.fim, agora, loja.fuso)) {
        continue;
      }
      await deps.repo.marcarAvisoFim(promocao.id, agora);
      const desconto = promocao.tipo === 'PERCENTUAL' ? `O desconto de ${promocao.valor}%` : 'A promoção';
      await deps.mensageiro.enviarTexto(
        loja.telefone,
        `⌛ ${desconto} que ia até ${diaEMes(promocao.fim, loja.fuso)} terminou e foi desligada. Os preços voltaram ao normal. Quer criar outra? É só me dizer.`,
      );
    } catch (erro) {
      logger.error({ err: erro, promocaoId: promocao.id }, 'falha ao encerrar a promoção vencida');
    }
  }
}
