import { DomainError } from '../../shared/errors/domain-error.js';
import type { RegrasDaLoja } from '../../orders/application/ports/loja-para-pedidos.js';
import type { MenuRepository } from '../menu.repository.js';
import { fotosDoItem } from '../fotos-do-produto.js';
import type { FotoProduto, ItemCardapio, ItemDraft, Sku } from '../menu.types.js';

let proximoId = 1;

export const REGRAS_PADRAO: RegrasDaLoja = {
  aceitaRetirada: true,
  fazEntrega: false,
  aceitaPagamentoNaEntrega: true,
  cadastroCompleto: true,
  faixasEntrega: [],
  horarios: [],
};

export type MenuRepositoryFake = MenuRepository & {
  /** Muda as regras de pedido de uma loja que já existe no fake. */
  definirRegras(empreendedorId: string, regras: Partial<RegrasDaLoja>): void;
  /** Galeria de um item, como se tivesse sido cadastrada. */
  definirFotos(itemId: string, fotos: FotoProduto[]): void;
  /** Tamanhos/cores de um item, como se tivessem sido cadastrados. */
  definirSkus(itemId: string, skus: Sku[]): void;
};

export function criarMenuRepositoryFake(): MenuRepositoryFake {
  const cardapiosPorEmpreendedor = new Map<string, string>();
  const regrasPorEmpreendedor = new Map<string, RegrasDaLoja>();
  const itensPorCardapio = new Map<string, ItemCardapio[]>();
  const fotosPorItem = new Map<string, FotoProduto[]>();
  const skusPorItem = new Map<string, Sku[]>();

  /** O item como a leitura do banco devolve. */
  function lido(item: ItemCardapio): ItemCardapio {
    return {
      ...item,
      fotos: fotosDoItem(fotosPorItem.get(item.id) ?? [], item.imagemUrl),
      skus: skusPorItem.get(item.id) ?? [],
    };
  }

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
      if (!cardapioId) {
        return null;
      }
      const itens = (itensPorCardapio.get(cardapioId) ?? []).filter((item) => item.ativo).map(lido);
      return { loja: null, secoes: itens.length ? [{ id: null, nome: 'Outros', itens }] : [], itens };
    },

    async obterRegrasDePedido(empreendedorId: string) {
      if (!cardapiosPorEmpreendedor.has(empreendedorId)) {
        return null;
      }
      return regrasPorEmpreendedor.get(empreendedorId) ?? REGRAS_PADRAO;
    },

    definirRegras(empreendedorId, regras) {
      regrasPorEmpreendedor.set(empreendedorId, { ...REGRAS_PADRAO, ...regras });
    },

    definirFotos(itemId, fotos) {
      fotosPorItem.set(itemId, fotos);
    },

    definirSkus(itemId, skus) {
      skusPorItem.set(itemId, skus);
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
