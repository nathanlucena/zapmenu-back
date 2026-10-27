/**
 * Promoções da loja: preço fixo ou desconto em %, recorrentes por dia da
 * semana e horário, com início e fim opcionais. O precoBase do item nunca é
 * alterado: a promoção é aplicada na hora de mostrar e de precificar o pedido.
 */

export type TipoPromocao = 'PRECO_FIXO' | 'PERCENTUAL';

/** Loja toda, algumas categorias ou alguns itens. */
export type AlvoPromocao = { tipo: 'LOJA' } | { tipo: 'CATEGORIAS'; ids: string[] } | { tipo: 'ITENS'; ids: string[] };

export interface Promocao {
  id: string;
  lojaId: string;
  tipo: TipoPromocao;
  /** Preço em reais (PRECO_FIXO) ou porcentagem de 1 a 90 (PERCENTUAL). */
  valor: number;
  /** 0 = domingo … 6 = sábado. Vazio = todos os dias. */
  diasSemana: number[];
  /** "HH:MM" no fuso da loja. Sem horário = o dia inteiro. */
  horaInicio?: string;
  horaFim?: string;
  inicio?: Date;
  fim?: Date;
  ativa: boolean;
  alvo: AlvoPromocao;
  /** O lojista já foi avisado de que ela venceu. */
  avisoFimEm?: Date;
  criadaEm: Date;
}

export const PERCENTUAL_MINIMO = 1;
export const PERCENTUAL_MAXIMO = 90;
/** Acima disso o lojista confirma duas vezes. */
export const PERCENTUAL_COM_CONFIRMACAO_EXTRA = 50;

export const NOMES_DOS_DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;

function minutos(hhmm: string): number {
  const [horas = 0, mins = 0] = hhmm.split(':').map(Number);
  return horas * 60 + mins;
}

/** Dia da semana (0–6) e minuto do dia no fuso da loja. */
export function diaEMinutoNoFuso(agora: Date, fuso: string): { dia: number; minuto: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora);
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parte('weekday'));
  return { dia, minuto: Number(parte('hour')) * 60 + Number(parte('minute')) };
}

const valeNoDia = (promocao: Pick<Promocao, 'diasSemana'>, dia: number) =>
  promocao.diasSemana.length === 0 || promocao.diasSemana.includes(dia);

/**
 * A promoção vale neste instante? Confere ativa, início e fim, o dia da semana
 * e o horário no fuso da loja. Horário que vira a madrugada (18:00 às 02:00)
 * pertence ao dia em que começou.
 */
export function promocaoValeAgora(promocao: Promocao, agora: Date, fuso: string): boolean {
  if (!promocao.ativa) return false;
  if (promocao.inicio && agora < promocao.inicio) return false;
  if (promocao.fim && agora > promocao.fim) return false;

  const { dia, minuto } = diaEMinutoNoFuso(agora, fuso);
  if (!promocao.horaInicio || !promocao.horaFim) {
    return valeNoDia(promocao, dia);
  }
  const abre = minutos(promocao.horaInicio);
  const fecha = minutos(promocao.horaFim);
  if (fecha > abre) {
    return valeNoDia(promocao, dia) && minuto >= abre && minuto < fecha;
  }
  // Vira a madrugada: a parte de hoje à noite, ou a de ontem depois da meia-noite.
  return (valeNoDia(promocao, dia) && minuto >= abre) || (valeNoDia(promocao, (dia + 6) % 7) && minuto < fecha);
}

/** O item que a promoção pode alcançar. */
export interface AlvoDoItem {
  id: string;
  categoriaId?: string;
}

export function promocaoAlcanca(promocao: Pick<Promocao, 'alvo'>, item: AlvoDoItem): boolean {
  switch (promocao.alvo.tipo) {
    case 'LOJA':
      return true;
    case 'CATEGORIAS':
      return item.categoriaId !== undefined && promocao.alvo.ids.includes(item.categoriaId);
    case 'ITENS':
      return promocao.alvo.ids.includes(item.id);
  }
}

/** Preço com a promoção, em reais. Percentual arredonda para baixo no centavo. */
export function aplicarPromocao(preco: number, promocao: Pick<Promocao, 'tipo' | 'valor'>): number {
  if (promocao.tipo === 'PRECO_FIXO') {
    return promocao.valor;
  }
  const centavos = Math.round(preco * 100);
  return Math.floor((centavos * (100 - promocao.valor)) / 100) / 100;
}

/** A regra que o item mostra e o pedido cobra: a promoção vencedora e o seu selo. */
export interface DescontoDoItem {
  promocaoId: string;
  tipo: TipoPromocao;
  valor: number;
  /** "Promoção de quarta", "-10%". */
  rotulo: string;
}

/**
 * Entre as promoções que valem agora para o item, a que dá o menor preço
 * sobre `preco`. Não acumulam. Preço fixo maior ou igual ao normal não é promoção.
 */
export function melhorPromocao(
  item: AlvoDoItem & { preco: number },
  promocoes: Promocao[],
  agora: Date,
  fuso: string,
): { desconto: DescontoDoItem; preco: number } | undefined {
  let melhor: { desconto: DescontoDoItem; preco: number } | undefined;
  for (const promocao of promocoes) {
    if (!promocaoAlcanca(promocao, item) || !promocaoValeAgora(promocao, agora, fuso)) continue;
    const preco = aplicarPromocao(item.preco, promocao);
    if (preco >= item.preco) continue;
    if (!melhor || preco < melhor.preco) {
      melhor = {
        preco,
        desconto: { promocaoId: promocao.id, tipo: promocao.tipo, valor: promocao.valor, rotulo: rotuloDaPromocao(promocao) },
      };
    }
  }
  return melhor;
}

/** Selo da vitrine: "-10%" no percentual; "Promoção de quarta" (ou "Promoção") no preço fixo. */
export function rotuloDaPromocao(promocao: Pick<Promocao, 'tipo' | 'valor' | 'diasSemana'>): string {
  if (promocao.tipo === 'PERCENTUAL') {
    return `-${promocao.valor}%`;
  }
  if (promocao.diasSemana.length === 1) {
    return `Promoção de ${NOMES_DOS_DIAS[promocao.diasSemana[0]!]}`;
  }
  return 'Promoção';
}

/** "quarta e quinta", "todos os dias", "segunda, quarta e sexta". */
export function descreverDias(diasSemana: number[]): string {
  if (diasSemana.length === 0 || diasSemana.length === 7) return 'todos os dias';
  const nomes = [...diasSemana].sort((a, b) => a - b).map((dia) => NOMES_DOS_DIAS[dia]!);
  return nomes.length === 1 ? nomes[0]! : `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}`;
}

/** Venceu (fim no passado), mesmo que ainda esteja marcada como ativa. */
export function venceu(promocao: Pick<Promocao, 'fim'>, agora: Date): boolean {
  return promocao.fim !== undefined && agora > promocao.fim;
}

/** Recurso do plano que libera a promoção: preço fixo é PROMOCOES; percentual, DESCONTO_PERCENTUAL. */
export function recursoDaPromocao(tipo: TipoPromocao): 'PROMOCOES' | 'DESCONTO_PERCENTUAL' {
  return tipo === 'PRECO_FIXO' ? 'PROMOCOES' : 'DESCONTO_PERCENTUAL';
}

/** A promoção como sai do banco (sem depender do ORM): valor decimal e alvos em linhas. */
export interface RegistroPromocao {
  id: string;
  lojaId: string;
  tipo: TipoPromocao;
  valor: { toString(): string } | number;
  diasSemana: number[];
  horaInicio: string | null;
  horaFim: string | null;
  inicio: Date | null;
  fim: Date | null;
  ativa: boolean;
  avisoFimEm: Date | null;
  criadaEm: Date;
  alvos: { itemId: string | null; categoriaId: string | null }[];
}

/** Sem alvos = a loja toda; com categoria em algum alvo = categorias; senão, itens. */
export function promocaoDoRegistro(registro: RegistroPromocao): Promocao {
  const categorias = registro.alvos.flatMap((alvo) => (alvo.categoriaId ? [alvo.categoriaId] : []));
  const itens = registro.alvos.flatMap((alvo) => (alvo.itemId ? [alvo.itemId] : []));
  const alvo: AlvoPromocao =
    categorias.length > 0 ? { tipo: 'CATEGORIAS', ids: categorias } : itens.length > 0 ? { tipo: 'ITENS', ids: itens } : { tipo: 'LOJA' };
  return {
    id: registro.id,
    lojaId: registro.lojaId,
    tipo: registro.tipo,
    valor: Number(registro.valor),
    diasSemana: registro.diasSemana,
    horaInicio: registro.horaInicio ?? undefined,
    horaFim: registro.horaFim ?? undefined,
    inicio: registro.inicio ?? undefined,
    fim: registro.fim ?? undefined,
    ativa: registro.ativa,
    avisoFimEm: registro.avisoFimEm ?? undefined,
    criadaEm: registro.criadaEm,
    alvo,
  };
}
