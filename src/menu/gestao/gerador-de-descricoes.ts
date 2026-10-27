import type { SegmentoLoja } from '../menu.types.js';

/** O que a IA pode usar para escrever: só o que a loja já disse do produto. */
export interface ProdutoParaDescrever {
  nome: string;
  descricaoAtual?: string;
  categoria?: string;
  /** Opções que a loja cadastrou (sabores, tamanhos, cores). */
  detalhes?: string[];
  segmento?: SegmentoLoja;
}

/** Duas opções de descrição de até 200 caracteres. Lança erro se a IA falhar. */
export interface GeradorDeDescricoes {
  sugerir(produto: ProdutoParaDescrever): Promise<[string, string]>;
}

export const TAMANHO_MAXIMO_DESCRICAO = 200;

/** Corta no fim da última palavra que cabe, sem reticências soltas. */
export function caberNaDescricao(texto: string): string {
  const limpo = texto.replace(/\s+/g, ' ').trim().replace(/^["“]|["”]$/g, '');
  if (limpo.length <= TAMANHO_MAXIMO_DESCRICAO) return limpo;
  const corte = limpo.slice(0, TAMANHO_MAXIMO_DESCRICAO + 1);
  return corte.slice(0, corte.lastIndexOf(' ')).replace(/[,;:\s]+$/, '');
}
