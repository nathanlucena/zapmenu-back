/** Relatório de vendas da loja: só conta pedidos que viraram venda (PAGO ou CONFIRMADO). */

/** Status de quem já virou venda: pago ou confirmado, e o que vem depois. */
export const STATUS_DE_VENDA = ['PAGO', 'CONFIRMADO', 'SEPARADO', 'SAIU_PARA_ENTREGA', 'ENVIADO', 'PRONTO_PARA_RETIRADA', 'CONCLUIDO'] as const;

export interface PedidoParaRelatorio {
  status: string;
  /** Itens + entrega. */
  valorTotal: number;
  criadoEm: Date;
  modalidade: 'RETIRADA' | 'ENTREGA' | 'ENVIO';
  formaPagamento: 'PIX' | 'DINHEIRO' | 'CARTAO';
  itens: { nome: string; quantidade: number; precoUnitario: number }[];
}

export interface ResumoDeVendas {
  total: number;
  pedidos: number;
  ticketMedio: number;
  /** Os mais vendidos por quantidade (no máximo 5). */
  maisVendidos: { nome: string; quantidade: number }[];
  porModalidade: Partial<Record<PedidoParaRelatorio['modalidade'], number>>;
  porPagamento: Partial<Record<PedidoParaRelatorio['formaPagamento'], number>>;
  /** Hora (0–23, no fuso da loja) com mais pedidos e quantos. */
  pico?: { hora: number; pedidos: number };
}

const MAIS_VENDIDOS = 5;

function horaNoFuso(instante: Date, fuso: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: fuso, hour: '2-digit', hourCycle: 'h23' }).format(instante));
}

function centavos(valor: number): number {
  return Math.round(valor * 100);
}

export function resumirVendas(todos: PedidoParaRelatorio[], fuso: string): ResumoDeVendas {
  // Pedido que não chegou a ser pago ou confirmado (expirado, recusado, aguardando…) não conta.
  const pedidos = todos.filter((pedido) => (STATUS_DE_VENDA as readonly string[]).includes(pedido.status));
  const totalCentavos = pedidos.reduce((soma, pedido) => soma + centavos(pedido.valorTotal), 0);
  const quantidades = new Map<string, number>();
  const porModalidade: ResumoDeVendas['porModalidade'] = {};
  const porPagamento: ResumoDeVendas['porPagamento'] = {};
  const porHora = new Map<number, number>();

  for (const pedido of pedidos) {
    for (const item of pedido.itens) {
      quantidades.set(item.nome, (quantidades.get(item.nome) ?? 0) + item.quantidade);
    }
    porModalidade[pedido.modalidade] = (porModalidade[pedido.modalidade] ?? 0) + 1;
    porPagamento[pedido.formaPagamento] = (porPagamento[pedido.formaPagamento] ?? 0) + 1;
    const hora = horaNoFuso(pedido.criadoEm, fuso);
    porHora.set(hora, (porHora.get(hora) ?? 0) + 1);
  }

  const maisVendidos = [...quantidades.entries()]
    .map(([nome, quantidade]) => ({ nome, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, 'pt-BR'))
    .slice(0, MAIS_VENDIDOS);
  // Empate na hora de pico: a mais cedo.
  const pico = [...porHora.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];

  return {
    total: totalCentavos / 100,
    pedidos: pedidos.length,
    ticketMedio: pedidos.length ? Math.round(totalCentavos / pedidos.length) / 100 : 0,
    maisVendidos,
    porModalidade,
    porPagamento,
    ...(pico && { pico: { hora: pico[0], pedidos: pico[1] } }),
  };
}

/** "▲ 12%", "▼ 5%", "= 0%"; sem base de comparação, undefined. */
export function variacao(atual: number, anterior: number): string | undefined {
  if (anterior === 0) {
    return undefined;
  }
  const percentual = Math.round(((atual - anterior) / anterior) * 100);
  if (percentual === 0) return '= 0%';
  return percentual > 0 ? `▲ ${percentual}%` : `▼ ${Math.abs(percentual)}%`;
}

function reais(valor: number): string {
  return `R$ ${valor.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

function comVariacao(texto: string, atual: number, anterior?: number): string {
  const mudou = anterior === undefined ? undefined : variacao(atual, anterior);
  return mudou ? `${texto} (${mudou})` : texto;
}

function partes<T extends string>(contagem: Partial<Record<T, number>>, nomes: Record<T, string>, total: number): string {
  return (Object.keys(nomes) as T[])
    .filter((chave) => contagem[chave])
    .map((chave) => `${nomes[chave]} ${Math.round(((contagem[chave] ?? 0) / total) * 100)}%`)
    .join(' · ');
}

const MODALIDADES = { ENTREGA: 'Entrega', RETIRADA: 'Retirada', ENVIO: 'Correios' } as const;
const PAGAMENTOS = { PIX: 'PIX', CARTAO: 'Cartão na entrega', DINHEIRO: 'Dinheiro na entrega' } as const;

/**
 * Texto do relatório para o WhatsApp. `anterior` é o período de mesmo tamanho
 * logo antes, para as setas de variação. Sem pedidos, uma mensagem curta.
 */
export function textoDoRelatorio(titulo: string, atual: ResumoDeVendas, anterior?: ResumoDeVendas, comparacao?: string): string {
  if (atual.pedidos === 0) {
    const antes = anterior?.pedidos
      ? ` No período anterior ${anterior.pedidos === 1 ? 'foi 1 pedido' : `foram ${anterior.pedidos} pedidos`}.`
      : '';
    return `📊 *${titulo}*\nNenhuma venda neste período.${antes}`;
  }
  const linhas = [
    `📊 *${titulo}*`,
    '',
    `💰 Total vendido: *${comVariacao(reais(atual.total), atual.total, anterior?.total)}*`,
    `🧾 Pedidos: *${comVariacao(String(atual.pedidos), atual.pedidos, anterior?.pedidos)}*`,
    `🎯 Ticket médio: *${comVariacao(reais(atual.ticketMedio), atual.ticketMedio, anterior?.ticketMedio)}*`,
    '',
    '🏆 Mais vendidos:',
    ...atual.maisVendidos.map((item, indice) => `${indice + 1}. ${item.nome} — ${item.quantidade}`),
    '',
    `🛵 ${partes(atual.porModalidade, MODALIDADES, atual.pedidos)}`,
    `💳 ${partes(atual.porPagamento, PAGAMENTOS, atual.pedidos)}`,
    ...(atual.pico ? [`⏰ Horário de pico: ${atual.pico.hora}h às ${(atual.pico.hora + 1) % 24}h (${atual.pico.pedidos} ${atual.pico.pedidos === 1 ? 'pedido' : 'pedidos'})`] : []),
  ];
  if (anterior && comparacao) {
    linhas.push('', `▲▼ comparado com ${comparacao}.`);
  }
  return linhas.join('\n');
}
