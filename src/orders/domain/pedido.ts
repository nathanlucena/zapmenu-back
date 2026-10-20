export type StatusPedido =
  | 'AGUARDANDO_CONFIRMACAO'
  | 'AGUARDANDO_PAGAMENTO'
  | 'PAGO'
  | 'EXPIRADO'
  | 'CANCELADO';

export type ModalidadePedido = 'RETIRADA' | 'ENTREGA';

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
}

export interface ItemPedidoInput {
  itemCardapioId: string;
  quantidade: number;
  precoUnitario: number;
  variacaoEscolhida?: Record<string, unknown>;
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
}

/** O que o app do cliente vê de um pedido: sem telefone, endereço do cliente nem ids internos. */
export interface ResumoPedidoPublico {
  codigoCurto: string;
  status: StatusPedido;
  modalidade: ModalidadePedido;
  /** Já inclui a taxa de entrega. */
  valorTotal: number;
  taxaEntrega: number;
  expiraEm: Date;
  criadoEm: Date;
  nomeLoja?: string;
  itens: {
    nome: string;
    quantidade: number;
    precoUnitario: number;
    variacaoEscolhida?: Record<string, unknown>;
  }[];
}

const TRANSICOES_PERMITIDAS: Record<StatusPedido, StatusPedido[]> = {
  AGUARDANDO_CONFIRMACAO: ['AGUARDANDO_PAGAMENTO', 'EXPIRADO', 'CANCELADO'],
  AGUARDANDO_PAGAMENTO: ['PAGO', 'EXPIRADO', 'CANCELADO'],
  PAGO: [],
  EXPIRADO: [],
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

export function estaExpirado(pedido: Pick<Pedido, 'status' | 'expiraEm'>, agora: Date): boolean {
  return pedido.status === 'AGUARDANDO_CONFIRMACAO' && agora > pedido.expiraEm;
}
