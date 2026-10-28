import { DomainError } from '../shared/errors/domain-error.js';
import type { ItemCardapio, Sku } from './menu.types.js';

/** "Tamanho M azul", "Tamanho G", "Preto". */
export function descreverSku(sku: Pick<Sku, 'tamanho' | 'cor'>): string {
  if (sku.tamanho) {
    return [`Tamanho ${sku.tamanho}`, sku.cor?.toLowerCase()].filter(Boolean).join(' ');
  }
  return sku.cor ? sku.cor.charAt(0).toUpperCase() + sku.cor.slice(1) : 'Opção única';
}

/**
 * O SKU que o cliente escolheu, conferido contra o estoque. Item sem SKU não
 * aceita escolha e devolve undefined (segue só com as variações, como na comida).
 * `quantidade` é o total pedido desse SKU no carrinho inteiro.
 */
export function escolherSku(item: ItemCardapio, skuId: string | undefined, quantidade: number): Sku | undefined {
  const skus = item.skus ?? [];
  if (skus.length === 0) {
    if (skuId) {
      throw new DomainError(`"${item.nome}" não tem tamanho ou cor para escolher.`, 'SKU_INVALIDO');
    }
    return undefined;
  }
  if (!skuId) {
    throw new DomainError(`Escolha o tamanho e a cor de "${item.nome}".`, 'SKU_OBRIGATORIO');
  }
  const sku = skus.find((candidato) => candidato.id === skuId && candidato.ativo);
  if (!sku) {
    throw new DomainError(`Essa opção de "${item.nome}" não está mais disponível.`, 'SKU_INVALIDO');
  }
  if (sku.estoque <= 0) {
    throw new DomainError(`${descreverSku(sku)} esgotado em "${item.nome}".`, 'SKU_ESGOTADO');
  }
  if (quantidade > sku.estoque) {
    const restam = sku.estoque === 1 ? 'só resta 1 unidade' : `só restam ${sku.estoque} unidades`;
    throw new DomainError(`${descreverSku(sku)} de "${item.nome}": ${restam}.`, 'SKU_ESGOTADO');
  }
  return sku;
}

/** Tamanho e cor escolhidos, para guardar no pedido junto das variações (a loja vê o que separar). */
export function escolhaDoSku(sku: Pick<Sku, 'tamanho' | 'cor'>): Record<string, string> {
  return {
    ...(sku.tamanho && { Tamanho: sku.tamanho }),
    ...(sku.cor && { Cor: sku.cor }),
  };
}
