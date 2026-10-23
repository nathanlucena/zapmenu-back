import type { CardapioDePrecos } from '../orders/application/ports/cardapio-de-precos.js';
import { DomainError } from '../shared/errors/domain-error.js';
import type { MenuRepository } from './menu.repository.js';
import { calcularPrecoUnitario, lojaNaoEncontrada } from './menu.service.js';
import { escolhaDoSku, escolherSku } from './sku.js';

/** O cardápio como fonte de preços para os pedidos. */
export function criarCardapioDePrecos(menuRepo: MenuRepository): CardapioDePrecos {
  return {
    async precificar(empreendedorId, itensCarrinho) {
      const cardapio = await menuRepo.obterCardapioPublico(empreendedorId);
      if (!cardapio) {
        throw lojaNaoEncontrada();
      }
      const porId = new Map(cardapio.itens.map((item) => [item.id, item]));
      // O mesmo tamanho/cor pode vir em mais de uma linha (ex.: observações diferentes).
      const totalPorSku = new Map<string, number>();
      for (const { skuId, quantidade } of itensCarrinho) {
        if (skuId) {
          totalPorSku.set(skuId, (totalPorSku.get(skuId) ?? 0) + quantidade);
        }
      }

      return itensCarrinho.map((itemCarrinho) => {
        const item = porId.get(itemCarrinho.itemCardapioId);
        if (!item) {
          throw new DomainError('Um dos itens do carrinho não está mais disponível.', 'ITEM_INDISPONIVEL');
        }
        const { skuId, quantidade, variacaoEscolhida } = itemCarrinho;
        const sku = escolherSku(item, skuId, skuId ? totalPorSku.get(skuId)! : quantidade);
        return {
          itemCardapioId: item.id,
          skuId: sku?.id,
          quantidade,
          precoUnitario: calcularPrecoUnitario(item, variacaoEscolhida, sku),
          // Cópia do tamanho/cor no pedido: a loja vê o que separar mesmo se o SKU mudar depois.
          variacaoEscolhida: sku ? { ...variacaoEscolhida, ...escolhaDoSku(sku) } : variacaoEscolhida,
          observacao: itemCarrinho.observacao,
        };
      });
    },
  };
}
