export type StatusPedido =
  | 'AGUARDANDO_CONFIRMACAO'
  | 'AGUARDANDO_ACEITE'
  | 'AGUARDANDO_PAGAMENTO'
  | 'PAGO'
  | 'CONFIRMADO'
  | 'SEPARADO'
  | 'SAIU_PARA_ENTREGA'
  | 'ENVIADO'
  | 'PRONTO_PARA_RETIRADA'
  | 'CONCLUIDO'
  | 'EXPIRADO'
  | 'RECUSADO'
  | 'CANCELADO';

/** Como cada status aparece para pessoas (mensagens e logs), nunca o código técnico. */
export const ROTULO_STATUS_PEDIDO: Record<StatusPedido, string> = {
  AGUARDANDO_CONFIRMACAO: 'Aguardando envio no WhatsApp',
  AGUARDANDO_ACEITE: 'Aguardando a loja aceitar',
  AGUARDANDO_PAGAMENTO: 'Aguardando pagamento',
  // Pago (PIX) e confirmado (pagamento na entrega) são os dois "a loja está preparando".
  PAGO: 'Pago, em preparo',
  CONFIRMADO: 'Confirmado, em preparo (pagamento na entrega)',
  SEPARADO: 'Separado',
  SAIU_PARA_ENTREGA: 'Saiu para entrega',
  ENVIADO: 'Enviado',
  PRONTO_PARA_RETIRADA: 'Pronto para retirar',
  CONCLUIDO: 'Concluído',
  EXPIRADO: 'Expirado',
  RECUSADO: 'Recusado pela loja',
  CANCELADO: 'Cancelado',
};

/**
 * ENTREGA: envio próprio da loja (taxa fixa ou por distância), no restaurante e
 * no varejo. MELHOR_ENVIO: transportadora cotada no Melhor Envio. ENVIO: o
 * antigo frete fixo por região, removido; só aparece em pedidos antigos.
 */
export type ModalidadePedido = 'RETIRADA' | 'ENTREGA' | 'ENVIO' | 'MELHOR_ENVIO';

/** Despachado por transportadora (com rastreio): o Melhor Envio e o antigo frete fixo. */
export function porTransportadora(modalidade: ModalidadePedido | undefined): boolean {
  return modalidade === 'MELHOR_ENVIO' || modalidade === 'ENVIO';
}

/** Serviço do Melhor Envio escolhido no checkout (o preço é o do momento do pedido). */
export interface ServicoEnvio {
  id: string;
  nome: string;
  empresa: string;
  preco: number;
  prazoDias?: number;
}

/** PIX antes; dinheiro ou cartão na maquininha, na entrega ou no balcão. */
export type FormaPagamento = 'PIX' | 'DINHEIRO' | 'CARTAO';

export function pagaNaEntrega(forma: FormaPagamento | undefined): boolean {
  return forma === 'DINHEIRO' || forma === 'CARTAO';
}

/** "Dinheiro na entrega (troco para R$ 100.00)", "Cartão no balcão", "PIX". */
export function descreverPagamento(pedido: Pick<DetalhesPedido, 'formaPagamento' | 'trocoPara' | 'modalidade'>): string {
  const onde = pedido.modalidade === 'RETIRADA' ? 'no balcão' : 'na entrega';
  switch (pedido.formaPagamento) {
    case 'DINHEIRO':
      return `Dinheiro ${onde}${pedido.trocoPara ? ` (troco para R$ ${pedido.trocoPara.toFixed(2)})` : ' (sem troco)'}`;
    case 'CARTAO':
      return `Cartão ${onde}`;
    default:
      return 'PIX';
  }
}

/** Endereço de entrega já localizado no mapa (cópia: não muda se o cliente mudar de endereço depois). */
export interface EnderecoEntrega {
  enderecoFormatado: string;
  cep?: string;
  logradouro?: string;
  numero: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  latitude: number;
  longitude: number;
  distanciaKm: number;
}

/** Endereço de envio por transportadora: vem do CEP, sem mapa nem distância. */
export type EnderecoEnvio = Omit<EnderecoEntrega, 'latitude' | 'longitude' | 'distanciaKm'>;

/** O que o cliente informou além dos itens. Pedidos antigos não têm esses campos. */
export interface DetalhesPedido {
  modalidade?: ModalidadePedido;
  nomeCliente?: string;
  observacao?: string;
  /** Taxa de entrega ou frete do envio. Já somada no valorTotal. */
  taxaEntrega?: number;
  entrega?: EnderecoEntrega | EnderecoEnvio;
  /** Ausente = PIX (pedidos antigos). */
  formaPagamento?: FormaPagamento;
  /** Só no dinheiro: quanto o cliente vai entregar. */
  trocoPara?: number;
  /** Só no Melhor Envio. */
  servicoEnvio?: ServicoEnvio;
}

export interface ItemPedidoInput {
  itemCardapioId: string;
  /** Tamanho/cor vendido, quando o item tem SKUs. */
  skuId?: string;
  /** Nome do item no cardápio; só vem na leitura do pedido, para mensagens. */
  nome?: string;
  quantidade: number;
  precoUnitario: number;
  variacaoEscolhida?: Record<string, unknown>;
  /** Pedido do cliente para este item, ex.: "bem assada". */
  observacao?: string;
}

/**
 * SKU vendido sem estoque suficiente: dois pagamentos disputaram as últimas
 * unidades e o PIX já tinha sido pago. A loja combina com o cliente.
 */
export interface FaltaEstoque {
  skuId: string;
  /** Total pedido desse SKU. */
  quantidade: number;
  /** O que havia no estoque na hora do pagamento (já baixado para zero). */
  disponivel: number;
}

/** "falta estoque de Camiseta (Tamanho: M, Cor: Azul): pediu 2, havia 1". */
export function descreverFaltas(pedido: Pick<Pedido, 'itens'>, faltas: FaltaEstoque[]): string {
  return faltas
    .map((falta) => {
      const item = pedido.itens.find((candidato) => candidato.skuId === falta.skuId);
      const opcoes = Object.entries(item?.variacaoEscolhida ?? {}).map(([nome, escolha]) => `${nome}: ${String(escolha)}`);
      const nome = `${item?.nome ?? 'um item'}${opcoes.length > 0 ? ` (${opcoes.join(', ')})` : ''}`;
      return `falta estoque de ${nome}: pediu ${falta.quantidade}, havia ${falta.disponivel}`;
    })
    .join('; ');
}

export interface CarrinhoInput {
  empreendedorId: string;
  itens: ItemPedidoInput[];
}

export interface Pedido extends DetalhesPedido {
  id: string;
  codigoCurto: string;
  empreendedorId: string;
  telefoneCliente?: string;
  status: StatusPedido;
  valorTotal: number;
  itens: ItemPedidoInput[];
  expiraEm: Date;
  criadoEm: Date;
  confirmadoEm?: Date;
  /** Enquete de aceitar/recusar enviada à loja (id da mensagem no WhatsApp). */
  enqueteAceiteId?: string;
  /** Enquete de andamento (saiu/pronto, entregue/retirado) enviada à loja depois do pago/confirmado. */
  enqueteAndamentoId?: string;
  faltaEstoque?: FaltaEstoque[];
  codigoRastreio?: string;
  transportadora?: string;
  /** Etiqueta comprada no Melhor Envio. */
  etiquetaId?: string;
}

/** O que o app do cliente vê de um pedido: sem telefone, endereço do cliente nem ids internos. */
export interface ResumoPedidoPublico {
  codigoCurto: string;
  status: StatusPedido;
  modalidade: ModalidadePedido;
  formaPagamento: FormaPagamento;
  trocoPara?: number;
  /** Já inclui a taxa de entrega. */
  valorTotal: number;
  taxaEntrega: number;
  expiraEm: Date;
  criadoEm: Date;
  nomeLoja?: string;
  /** Depois que a loja envia por transportadora. */
  codigoRastreio?: string;
  transportadora?: string;
  /** Só enquanto o pedido aguarda pagamento: o mesmo PIX enviado no WhatsApp, para copiar na tela. */
  pix?: { copiaCola: string; qrCodeBase64?: string };
  itens: {
    nome: string;
    quantidade: number;
    precoUnitario: number;
    variacaoEscolhida?: Record<string, unknown>;
    observacao?: string;
  }[];
}

const TRANSICOES_PERMITIDAS: Record<StatusPedido, StatusPedido[]> = {
  AGUARDANDO_CONFIRMACAO: ['AGUARDANDO_ACEITE', 'EXPIRADO', 'CANCELADO'],
  AGUARDANDO_ACEITE: ['AGUARDANDO_PAGAMENTO', 'CONFIRMADO', 'RECUSADO', 'EXPIRADO', 'CANCELADO'],
  AGUARDANDO_PAGAMENTO: ['PAGO', 'EXPIRADO', 'CANCELADO'],
  // Pago e confirmado são "em preparo"; dali a loja avisa que saiu/está pronto e depois conclui.
  // Separado e enviado são as etapas do varejo; a comida pode seguir sem elas.
  PAGO: ['SEPARADO', 'SAIU_PARA_ENTREGA', 'ENVIADO', 'PRONTO_PARA_RETIRADA', 'CONCLUIDO'],
  CONFIRMADO: ['SEPARADO', 'SAIU_PARA_ENTREGA', 'ENVIADO', 'PRONTO_PARA_RETIRADA', 'CONCLUIDO'],
  SEPARADO: ['SAIU_PARA_ENTREGA', 'ENVIADO', 'PRONTO_PARA_RETIRADA', 'CONCLUIDO'],
  SAIU_PARA_ENTREGA: ['CONCLUIDO'],
  ENVIADO: ['CONCLUIDO'],
  PRONTO_PARA_RETIRADA: ['CONCLUIDO'],
  CONCLUIDO: [],
  EXPIRADO: [],
  RECUSADO: [],
  CANCELADO: [],
};

/**
 * Status em que o pedido virou venda e o estoque dos SKUs já foi baixado. Nenhum
 * deles volta para EXPIRADO, RECUSADO ou CANCELADO, então não há estoque a devolver.
 */
export const STATUS_DE_VENDA = ['PAGO', 'CONFIRMADO'] as const satisfies readonly StatusPedido[];

export type StatusDeVenda = (typeof STATUS_DE_VENDA)[number];

export function podeTransicionar(atual: StatusPedido, proximo: StatusPedido): boolean {
  return TRANSICOES_PERMITIDAS[atual].includes(proximo);
}

const REGEX_CODIGO_PEDIDO = /PED-[A-Z0-9]{4}/i;

export function extrairCodigoPedido(texto: string): string | null {
  const match = texto.match(REGEX_CODIGO_PEDIDO);
  return match ? match[0].toUpperCase() : null;
}

export type DecisaoPedido = 'ACEITAR' | 'RECUSAR';

const REGEX_DECISAO = /^\s*(aceitar|aceito|aceita|recusar|recuso|recusa)\b.*?(PED-[A-Z0-9]{4})/i;

/** Resposta da loja em texto ("aceitar PED-7KQ2" / "recusar PED-7KQ2"), alternativa à enquete. */
export function extrairDecisaoPedido(texto: string): { decisao: DecisaoPedido; codigoCurto: string } | null {
  const match = REGEX_DECISAO.exec(texto);
  if (!match) {
    return null;
  }
  return {
    decisao: match[1]!.toLowerCase().startsWith('aceit') ? 'ACEITAR' : 'RECUSAR',
    codigoCurto: match[2]!.toUpperCase(),
  };
}

export function calcularValorTotal(itens: ItemPedidoInput[]): number {
  return itens.reduce((total, item) => total + item.precoUnitario * item.quantidade, 0);
}

export function validarCarrinho(carrinho: CarrinhoInput): string[] {
  const erros: string[] = [];

  if (carrinho.itens.length === 0) {
    erros.push('O carrinho precisa de ao menos um item.');
  }
  for (const item of carrinho.itens) {
    if (item.quantidade <= 0) {
      erros.push(`Quantidade inválida para o item ${item.itemCardapioId}.`);
    }
    if (item.precoUnitario < 0) {
      erros.push(`Preço unitário inválido para o item ${item.itemCardapioId}.`);
    }
  }

  return erros;
}

/** Pedido aceito e ainda não concluído: em preparo, separado, a caminho ou pronto para retirar. */
export const STATUS_EM_ANDAMENTO: StatusPedido[] = [
  'PAGO',
  'CONFIRMADO',
  'SEPARADO',
  'SAIU_PARA_ENTREGA',
  'ENVIADO',
  'PRONTO_PARA_RETIRADA',
];

/**
 * Os que a conclusão automática fecha depois de algumas horas (comida). Separado
 * e enviado ficam de fora: uma encomenda pelos Correios leva dias.
 */
export const STATUS_QUE_CONCLUEM_SOZINHOS: StatusPedido[] = ['PAGO', 'CONFIRMADO', 'SAIU_PARA_ENTREGA', 'PRONTO_PARA_RETIRADA'];

/**
 * O que a loja informa depois do preparo: separou (varejo), saiu/está pronto
 * (conforme a modalidade), enviou por transportadora ou foi entregue/retirado.
 */
export type AndamentoPedido = 'SEPARADO' | 'A_CAMINHO' | 'ENVIADO' | 'CONCLUIDO';

export interface Rastreio {
  codigoRastreio?: string;
  transportadora?: string;
}

const REGEX_ANDAMENTO =
  /^\s*(separei|separado|separada|enviei|enviado|enviada|despachei|despachado|saiu|pronto|pronta|entregue|entreguei|retirado|retirada|conclu[ií]do)\b.*?(PED-[A-Z0-9]{4})/i;
/** Formato dos códigos dos Correios: AA123456789BR. */
const CODIGO_CORREIOS = /\b([A-Z]{2}\d{9}[A-Z]{2})\b/i;
const REGEX_RASTREIO = /\b(?:rastreio|rastreamento|c[oó]digo)\s*:?\s*([A-Z0-9]{6,40})\b/i;
const REGEX_TRANSPORTADORA = /\b(?:pel[oa]|via|transportadora)\s+(\p{L}[\p{L}\d-]*)/iu;

function andamentoDaPalavra(palavra: string): AndamentoPedido {
  if (palavra.startsWith('separ')) return 'SEPARADO';
  if (palavra.startsWith('envi') || palavra.startsWith('despach')) return 'ENVIADO';
  if (palavra === 'saiu' || palavra.startsWith('pront')) return 'A_CAMINHO';
  return 'CONCLUIDO';
}

/** "rastreio NX123BR pela Jadlog"; um código no formato dos Correios dispensa a palavra "rastreio". */
function extrairRastreio(texto: string): Rastreio | undefined {
  const codigoRastreio = (REGEX_RASTREIO.exec(texto)?.[1] ?? CODIGO_CORREIOS.exec(texto)?.[1])?.toUpperCase();
  const transportadora =
    REGEX_TRANSPORTADORA.exec(texto)?.[1] ?? (codigoRastreio && CODIGO_CORREIOS.test(codigoRastreio) ? 'Correios' : undefined);
  if (!codigoRastreio && !transportadora) {
    return undefined;
  }
  return {
    codigoRastreio,
    transportadora: transportadora && transportadora.charAt(0).toUpperCase() + transportadora.slice(1),
  };
}

/**
 * Alternativa em texto à enquete de andamento: "separei PED-7KQ2", "saiu PED-7KQ2",
 * "enviei PED-7KQ2 rastreio NX123456789BR", "entreguei PED-7KQ2".
 */
export function extrairAndamentoPedido(
  texto: string,
): { andamento: AndamentoPedido; codigoCurto: string; rastreio?: Rastreio } | null {
  const match = REGEX_ANDAMENTO.exec(texto);
  if (!match) {
    return null;
  }
  const andamento = andamentoDaPalavra(match[1]!.toLowerCase());
  const depoisDoCodigo = texto.slice(match.index + match[0].length);
  return {
    andamento,
    codigoCurto: match[2]!.toUpperCase(),
    ...(andamento === 'ENVIADO' && { rastreio: extrairRastreio(depoisDoCodigo) }),
  };
}

/** Saiu para entrega, enviado ou pronto para retirar, conforme a modalidade. */
export function statusACaminho(modalidade: ModalidadePedido | undefined): StatusPedido {
  switch (modalidade) {
    case 'ENTREGA':
      return 'SAIU_PARA_ENTREGA';
    case 'ENVIO':
    case 'MELHOR_ENVIO':
      return 'ENVIADO';
    default:
      return 'PRONTO_PARA_RETIRADA';
  }
}

/** Status que vencem em `expiraEm`: o cliente não mandou o código ou a loja não respondeu. */
export const STATUS_COM_PRAZO: StatusPedido[] = ['AGUARDANDO_CONFIRMACAO', 'AGUARDANDO_ACEITE'];

export function estaExpirado(pedido: Pick<Pedido, 'status' | 'expiraEm'>, agora: Date): boolean {
  return STATUS_COM_PRAZO.includes(pedido.status) && agora > pedido.expiraEm;
}
