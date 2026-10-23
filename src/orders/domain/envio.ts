/** Frete fixo que a loja configurou: um valor para todo o Brasil e exceções por UF. */
export interface FreteFixo {
  /** Para qualquer UF sem valor próprio. Sem ele, só envia para as UFs de `porUf`. */
  padrao?: number;
  /** { "PE": 12, "SP": 30 } */
  porUf: Record<string, number>;
}

/** Frete para a UF; undefined quando a loja não envia para lá. */
export function freteParaUf(frete: FreteFixo, uf: string): number | undefined {
  return frete.porUf[uf.toUpperCase()] ?? frete.padrao;
}

/** Tem algum valor configurado: sem isso, aceitar envio não serve para nada. */
export function freteConfigurado(frete: FreteFixo): boolean {
  return frete.padrao !== undefined || Object.keys(frete.porUf).length > 0;
}
