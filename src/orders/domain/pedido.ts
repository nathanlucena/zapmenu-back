export type StatusPedido =
  | 'AGUARDANDO_CONFIRMACAO'
  | 'AGUARDANDO_ACEITE'
  | 'AGUARDANDO_PAGAMENTO'
  | 'PAGO'
  | 'CONFIRMADO'
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
  EXPIRADO: 'Expirado',
  RECUSADO: 'Recusado pela loja',
  CANCELADO: 'Cancelado',
};

export type ModalidadePedido = 'RETIRADA' | 'ENTREGA';

/** PIX antes; dinheiro ou cartão na maquininha, na entrega ou no balcão. */
export type FormaPagamento = 'PIX' | 'DINHEIRO' | 'CARTAO';

export function pagaNaEntrega(forma: FormaPagamento | undefined): boolean {
  return forma === 'DINHEIRO' || forma === 'CARTAO';
}

/** "Dinheiro na entrega (troco para R$ 100.00)", "Cartão no balcão", "PIX". */
export function descreverPagamento(pedido: Pick<DetalhesPedido, 'formaPagamento' | 'trocoPara' | 'modalidade'>): string {
  const onde = pedido.modalidade === 'ENTREGA' ? 'na entrega' : 'no balcão';
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

/** O que o cliente informou além dos itens. Pedidos antigos não têm esses campos. */
export interface DetalhesPedido {
  modalidade?: ModalidadePedido;
  nomeCliente?: string;
  observacao?: string;
  /** Já somada no valorTotal. */
  taxaEntrega?: number;
  entrega?: EnderecoEntrega;
  /** Ausente = PIX (pedidos antigos). */
  formaPagamento?: FormaPagamento;
  /** Só no dinheiro: quanto o cliente vai entregar. */
  trocoPara?: number;
}

export interface ItemPedidoInput {
  itemCardapioId: string;
  /** Nome do item no cardápio; só vem na leitura do pedido, para mensagens. */
  nome?: string;
  quantidade: number;
  precoUnitario: number;
  variacaoEscolhida?: Record<string, unknown>;
  /** Pedido do cliente para este item, ex.: "bem assada". */
  observacao?: string;
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
  PAGO: [],
  CONFIRMADO: [],
  EXPIRADO: [],
  RECUSADO: [],
  CANCELADO: [],
};

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

/** Status que vencem em `expiraEm`: o cliente não mandou o código ou a loja não respondeu. */
export const STATUS_COM_PRAZO: StatusPedido[] = ['AGUARDANDO_CONFIRMACAO', 'AGUARDANDO_ACEITE'];

export function estaExpirado(pedido: Pick<Pedido, 'status' | 'expiraEm'>, agora: Date): boolean {
  return STATUS_COM_PRAZO.includes(pedido.status) && agora > pedido.expiraEm;
}
