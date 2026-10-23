import type { SegmentoLoja } from '../menu.types.js';
import { normalizar } from './comandos.js';

/** Os tipos que o lojista pode escolher hoje. Serviços existe no banco, mas ainda não é oferecido. */
export type TipoDaLoja = Extract<SegmentoLoja, 'COMIDA' | 'VAREJO'>;

export const PERGUNTA_TIPO = 'O que você vai vender pelo ZapMenu?';
export const OPCAO_CARDAPIO = '🍔 Cardápio (restaurante, lanchonete, delivery de comida)';
export const OPCAO_LOJA = '🛍️ Loja (roupas, acessórios, produtos)';
export const OPCOES_TIPO = [OPCAO_CARDAPIO, OPCAO_LOJA] as const;

/** Texto que acompanha a enquete: também dá para responder escrevendo. */
export const TEXTO_PERGUNTA_TIPO = [
  '👋 Antes de começar: o que você vai vender?',
  '',
  `*1.* ${OPCAO_CARDAPIO}`,
  `*2.* ${OPCAO_LOJA}`,
  '',
  'Toque numa opção da enquete ou responda *1* ou *2*.',
].join('\n');

const PALAVRAS_COMIDA = [
  'cardapio', 'comida', 'restaurante', 'lanchonete', 'lanche', 'lanches', 'delivery', 'pizzaria', 'pizza',
  'hamburgueria', 'hamburguer', 'marmita', 'marmitas', 'acai', 'bolo', 'bolos', 'doces', 'salgados', 'bar',
];
const MAX_PALAVRAS = 4;

// "loja" sozinha não entra: "minha loja" também é dito por quem vende comida.
const PALAVRAS_LOJA = [
  'roupa', 'roupas', 'acessorio', 'acessorios', 'produto', 'produtos', 'catalogo', 'varejo', 'moda',
  'boutique', 'calcado', 'calcados', 'sapato', 'sapatos', 'bolsa', 'bolsas', 'bijuteria', 'bijuterias',
];

/**
 * O tipo escolhido, sem IA: a opção da enquete, "1"/"2" ou uma resposta curta
 * com palavra que só aponta para um dos tipos. undefined quando não dá para ter certeza.
 */
export function tipoDaResposta(texto: string): TipoDaLoja | undefined {
  const normalizado = normalizar(texto);
  if (normalizado === normalizar(OPCAO_CARDAPIO) || /^(1|1\.|opcao 1)$/.test(normalizado)) return 'COMIDA';
  if (normalizado === normalizar(OPCAO_LOJA) || /^(2|2\.|opcao 2|(a |uma )?loja)$/.test(normalizado)) return 'VAREJO';
  // Só em respostas curtas: numa frase longa, o nome da loja ("Moda da Ana") engana.
  const lista = normalizado.split(/[^a-z0-9]+/).filter(Boolean);
  if (lista.length > MAX_PALAVRAS) return undefined;
  const palavras = new Set(lista);
  const comida = PALAVRAS_COMIDA.some((palavra) => palavras.has(palavra));
  const loja = PALAVRAS_LOJA.some((palavra) => palavras.has(palavra));
  if (comida === loja) return undefined;
  return comida ? 'COMIDA' : 'VAREJO';
}

/** A resposta é exatamente uma das opções da enquete (o voto chega como texto). */
export function ehOpcaoDaEnquete(texto: string): boolean {
  return OPCOES_TIPO.some((opcao) => normalizar(opcao) === normalizar(texto));
}

/** Como o robô chama a loja e a lista de itens em cada tipo. */
export interface Vocabulario {
  tipo: 'Cardápio' | 'Loja';
  /** "cardápio" | "catálogo" */
  lista: string;
  /** "item" | "produto" */
  item: string;
  itens: string;
  exemploItem: string;
}

export function vocabulario(segmento: SegmentoLoja | undefined): Vocabulario {
  return segmento === 'VAREJO'
    ? { tipo: 'Loja', lista: 'catálogo', item: 'produto', itens: 'produtos', exemploItem: 'camiseta básica 59,90, tamanhos P, M e G' }
    : { tipo: 'Cardápio', lista: 'cardápio', item: 'item', itens: 'itens', exemploItem: 'pizza calabresa 39,90' };
}

/** O que passa a valer e o que fica oculto ao trocar para `para`. Nada é apagado. */
export function oQueMudaNaTroca(para: TipoDaLoja): string {
  const mudanca =
    para === 'VAREJO'
      ? 'Ao virar *Loja*, os adicionais (variações com preço) deixam de aparecer na vitrine, e você passa a cadastrar tamanhos e cores com estoque, envio pelos Correios e política de troca.'
      : 'Ao virar *Cardápio*, tamanhos e cores com estoque, as fotos extras dos produtos, o envio pelos Correios e a política de troca deixam de aparecer na vitrine, e os adicionais voltam a valer.';
  return `${mudanca} Nada é apagado: se voltar para o tipo de agora, tudo reaparece.`;
}
