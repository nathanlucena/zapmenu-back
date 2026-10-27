import { lojaDisponivel, podeUsar, type SituacaoDoPlano } from '../planos/domain/assinatura.js';
import type { RegrasDaLoja } from '../orders/application/ports/loja-para-pedidos.js';
import type { CardapioPublico, LojaPublica } from './menu.types.js';

/**
 * A loja como o plano deixa aparecer. Nada é apagado: o que a loja configurou
 * num plano maior (ou no teste) só fica oculto, e volta se ela assinar de novo.
 * A entrega (distância ou taxa fixa) já vem resolvida pelo plano na leitura da loja.
 */
export function lojaNoPlano(loja: LojaPublica, plano: SituacaoDoPlano | undefined): LojaPublica {
  const coresECapa = podeUsar(plano, 'CORES_CAPA');
  return {
    ...loja,
    corDestaque: coresECapa ? loja.corDestaque : undefined,
    capaUrl: coresECapa ? loja.capaUrl : undefined,
    mostrarSelo: !podeUsar(plano, 'SEM_SELO'),
    ...(!lojaDisponivel(plano) && { indisponivel: true }),
  };
}

/** Loja suspensa: só o necessário para o app mostrar "temporariamente indisponível", sem o catálogo. */
export function cardapioNoPlano(cardapio: CardapioPublico, plano: SituacaoDoPlano | undefined): CardapioPublico {
  if (!cardapio.loja) {
    return cardapio;
  }
  const loja = lojaNoPlano(cardapio.loja, plano);
  return loja.indisponivel ? { ...cardapio, loja, secoes: [], itens: [] } : { ...cardapio, loja };
}

export function regrasNoPlano(regras: RegrasDaLoja, plano: SituacaoDoPlano | undefined): RegrasDaLoja {
  return {
    ...regras,
    ...(!lojaDisponivel(plano) && { indisponivel: true }),
  };
}
