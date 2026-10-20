import type { CardapioDePrecos } from '../orders/application/ports/cardapio-de-precos.js';
import { DomainError } from '../shared/errors/domain-error.js';
import type { MenuRepository } from './menu.repository.js';
import { calcularPrecoUnitario } from './menu.service.js';

/** O cardápio como fonte de preços para os pedidos. */
export function criarCardapioDePrecos(menuRepo: MenuRepository): CardapioDePrecos {
  return {
    async precificar(empreendedorId, itensCarrinho) {
      const { itens: disponiveis } = await menuRepo.obterCardapioPublico(empreendedorId);
      const porId = new Map(disponiveis.map((item) => [item.id, item]));

      return itensCarrinho.map((itemCarrinho) => {
        const item = porId.get(itemCarrinho.itemCardapioId);
        if (!item) {
          throw new DomainError('Um dos itens do carrinho não está mais disponível.', 'ITEM_INDISPONIVEL');
        }
        return {
          itemCardapioId: item.id,
          quantidade: itemCarrinho.quantidade,
          precoUnitario: calcularPrecoUnitario(item, itemCarrinho.variacaoEscolhida),
          variacaoEscolhida: itemCarrinho.variacaoEscolhida,
        };
      });
    },
  };
}
