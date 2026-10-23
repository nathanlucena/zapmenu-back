import type { ItemPedidoInput } from '../../domain/pedido.js';

export interface ItemCarrinho {
  itemCardapioId: string;
  /** Tamanho/cor escolhido; obrigatório quando o item tem SKUs. */
  skuId?: string;
  quantidade: number;
  /** { nomeDaVariacao: nomeDaOpcao }, ex.: { "Tamanho": "G" } */
  variacaoEscolhida?: Record<string, unknown>;
  observacao?: string;
}

/**
 * O preço de cada item vem sempre do cardápio, nunca do que o cliente enviou.
 * Lança DomainError ITEM_INDISPONIVEL, VARIACAO_INVALIDA, SKU_OBRIGATORIO,
 * SKU_INVALIDO ou SKU_ESGOTADO.
 */
export interface CardapioDePrecos {
  precificar(empreendedorId: string, itens: ItemCarrinho[]): Promise<ItemPedidoInput[]>;
}
