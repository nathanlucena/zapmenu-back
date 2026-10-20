export type StatusPedido =
  | 'AGUARDANDO_CONFIRMACAO'
  | 'AGUARDANDO_PAGAMENTO'
  | 'PAGO'
  | 'EXPIRADO'
  | 'CANCELADO';

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

export interface Pedido {
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
