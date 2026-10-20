import type { ItemPedidoInput } from '../../domain/pedido.js';

export interface ItemCarrinho {
  itemCardapioId: string;
  quantidade: number;
  /** { nomeDaVariacao: nomeDaOpcao }, ex.: { "Tamanho": "G" } */
  variacaoEscolhida?: Record<string, unknown>;
}

/**
 * O preço de cada item vem sempre do cardápio, nunca do que o cliente enviou.
 * Lança DomainError ITEM_INDISPONIVEL ou VARIACAO_INVALIDA.
 */
export interface CardapioDePrecos {
  precificar(empreendedorId: string, itens: ItemCarrinho[]): Promise<ItemPedidoInput[]>;
}
