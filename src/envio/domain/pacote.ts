/** Peso e medidas de um produto para o frete. Qualquer campo pode faltar: vale o padrão da categoria e depois o geral. */
export interface Medidas {
  pesoGramas?: number;
  alturaCm?: number;
  larguraCm?: number;
  comprimentoCm?: number;
}

export type MedidasCompletas = Required<Medidas>;

/**
 * Padrão quando nem o produto nem a categoria têm medidas: uma peça de roupa
 * dobrada num envelope (acima do mínimo dos Correios, 2 × 11 × 16 cm).
 */
export const MEDIDAS_PADRAO: MedidasCompletas = { pesoGramas: 300, alturaCm: 4, larguraCm: 20, comprimentoCm: 30 };

/** Produto, depois categoria, depois o padrão, campo a campo. */
export function medidasDoProduto(produto: Medidas, categoria: Medidas = {}): MedidasCompletas {
  return {
    pesoGramas: produto.pesoGramas ?? categoria.pesoGramas ?? MEDIDAS_PADRAO.pesoGramas,
    alturaCm: produto.alturaCm ?? categoria.alturaCm ?? MEDIDAS_PADRAO.alturaCm,
    larguraCm: produto.larguraCm ?? categoria.larguraCm ?? MEDIDAS_PADRAO.larguraCm,
    comprimentoCm: produto.comprimentoCm ?? categoria.comprimentoCm ?? MEDIDAS_PADRAO.comprimentoCm,
  };
}

/** Um produto do pacote como o Melhor Envio pede (peso em kg, valor para o seguro). */
export interface ProdutoDoPacote {
  id: string;
  larguraCm: number;
  alturaCm: number;
  comprimentoCm: number;
  pesoKg: number;
  /** Valor unitário declarado (seguro). */
  valor: number;
  quantidade: number;
}

export function produtoDoPacote(id: string, medidas: MedidasCompletas, valor: number, quantidade: number): ProdutoDoPacote {
  return {
    id,
    larguraCm: medidas.larguraCm,
    alturaCm: medidas.alturaCm,
    comprimentoCm: medidas.comprimentoCm,
    pesoKg: Math.round(medidas.pesoGramas) / 1000,
    valor,
    quantidade,
  };
}
