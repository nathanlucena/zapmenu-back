import type { CardapioDePrecos } from '../orders/application/ports/cardapio-de-precos.js';
import { DomainError } from '../shared/errors/domain-error.js';
import type { MenuRepository } from './menu.repository.js';
import { calcularPrecoUnitario, lojaNaoEncontrada } from './menu.service.js';

/** O cardápio como fonte de preços para os pedidos. */
export function criarCardapioDePrecos(menuRepo: MenuRepository): CardapioDePrecos {
  return {
    async precificar(empreendedorId, itensCarrinho) {
      const cardapio = await menuRepo.obterCardapioPublico(empreendedorId);
      if (!cardapio) {
        throw lojaNaoEncontrada();
      }
      const porId = new Map(cardapio.itens.map((item) => [item.id, item]));

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
