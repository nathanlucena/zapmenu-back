/** Prepara as fotos do topo da loja: a capa em 3:1 e o logo quadrado, leves para a vitrine. */
export interface ImagensDaLoja {
  /** data URI → data URI 1200×400, menos de 300 KB. */
  prepararCapa(dataUri: string): Promise<string>;
  /** data URI → data URI 400×400, menos de 300 KB. */
  prepararLogo(dataUri: string): Promise<string>;
}

export const LIMITE_DE_BYTES = 300 * 1024;
export const TAMANHO_DA_CAPA = { largura: 1200, altura: 400 } as const;
export const TAMANHO_DO_LOGO = { largura: 400, altura: 400 } as const;
