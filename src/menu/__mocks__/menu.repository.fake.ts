import { DomainError } from '../../shared/errors/domain-error.js';
import type { MenuRepository } from '../menu.repository.js';
import type { ItemCardapio, ItemDraft } from '../menu.types.js';

let proximoId = 1;

export function criarMenuRepositoryFake(): MenuRepository {
  const cardapiosPorEmpreendedor = new Map<string, string>();
  const itensPorCardapio = new Map<string, ItemCardapio[]>();

  function buscarItem(cardapioId: string, itemId: string): ItemCardapio {
    const item = itensPorCardapio.get(cardapioId)?.find((candidato) => candidato.id === itemId);
    if (!item) {
      throw new DomainError(`Item ${itemId} não encontrado neste cardápio.`, 'ITEM_NAO_ENCONTRADO');
    }
    return item;
  }

  return {
    async obterCardapioPublico(empreendedorId: string) {
      const cardapioId = cardapiosPorEmpreendedor.get(empreendedorId);
      const itens = (cardapioId ? itensPorCardapio.get(cardapioId) ?? [] : []).filter((item) => item.ativo);
      return { loja: null, secoes: itens.length ? [{ id: null, nome: 'Outros', itens }] : [], itens };
    },

    async obterOuCriarCardapio(empreendedorId: string) {
      let cardapioId = cardapiosPorEmpreendedor.get(empreendedorId);
      if (!cardapioId) {
        cardapioId = `cardapio-${proximoId++}`;
        cardapiosPorEmpreendedor.set(empreendedorId, cardapioId);
        itensPorCardapio.set(cardapioId, []);
      }
      return { id: cardapioId };
    },

    async adicionarItem(cardapioId: string, draft: ItemDraft) {
      const item: ItemCardapio = { ...draft, id: `item-${proximoId++}`, cardapioId, ativo: true };
      const itens = itensPorCardapio.get(cardapioId) ?? [];
      itens.push(item);
      itensPorCardapio.set(cardapioId, itens);
      return item;
    },

    async listarItensAtivos(cardapioId: string) {
      return (itensPorCardapio.get(cardapioId) ?? []).filter((item) => item.ativo);
    },

    async listarItens(cardapioId: string) {
      return [...(itensPorCardapio.get(cardapioId) ?? [])];
    },

    async atualizarItem(cardapioId, itemId, alteracoes) {
      Object.assign(buscarItem(cardapioId, itemId), alteracoes);
    },

    async definirAtivo(cardapioId, itemId, ativo) {
      buscarItem(cardapioId, itemId).ativo = ativo;
    },

    async removerItem(cardapioId, itemId) {
      buscarItem(cardapioId, itemId);
      const restantes = (itensPorCardapio.get(cardapioId) ?? []).filter((item) => item.id !== itemId);
      itensPorCardapio.set(cardapioId, restantes);
    },
  };
}
