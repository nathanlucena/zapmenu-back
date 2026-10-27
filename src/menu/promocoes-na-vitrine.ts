import { podeUsar, type SituacaoDoPlano } from '../planos/domain/assinatura.js';
import { melhorPromocao, recursoDaPromocao, type Promocao } from '../promocoes/domain/promocao.js';
import type { ItemCardapio } from './menu.types.js';

/**
 * Os itens com a promoção que vale agora (no fuso da loja), para a vitrine e
 * para o preço do pedido. Promoção fora do plano fica guardada, mas não vale.
 * O precoBase não muda: a promoção vai em `item.promocao`.
 */
export function comPromocoes(
  itens: ItemCardapio[],
  promocoes: Promocao[],
  plano: SituacaoDoPlano | undefined,
  agora: Date,
  fuso: string,
): ItemCardapio[] {
  const doPlano = promocoes.filter((promocao) => podeUsar(plano, recursoDaPromocao(promocao.tipo)));
  if (doPlano.length === 0) {
    return itens;
  }
  return itens.map((item) => {
    const melhor = melhorPromocao({ id: item.id, categoriaId: item.categoriaId, preco: item.precoBase }, doPlano, agora, fuso);
    return melhor ? { ...item, promocao: { ...melhor.desconto, precoPromocional: melhor.preco } } : item;
  });
}
