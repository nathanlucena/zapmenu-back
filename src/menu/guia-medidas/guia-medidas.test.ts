import { describe, expect, it } from 'vitest';
import { guiaDoItem, problemasDoGuia, tabelaEmTexto, type GuiaMedidas } from './guia-medidas.js';

const CAMISETAS: GuiaMedidas = {
  nome: 'Camisetas',
  colunas: ['Busto', 'Comprimento'],
  linhas: [
    { tamanho: 'P', medidas: [96, 68] },
    { tamanho: 'M', medidas: [100, 70.5] },
  ],
};

describe('guia de medidas', () => {
  it('tabela alinhada em monoespaço, em cm', () => {
    expect(tabelaEmTexto(CAMISETAS)).toBe(['```', 'Tam.  Busto  Comprimento', 'P     96     68', 'M     100    70,5', '```', '_medidas em cm_'].join('\n'));
  });

  it('recusa colunas e medidas que não batem, tamanho repetido e medida fora do razoável', () => {
    expect(problemasDoGuia(CAMISETAS)).toEqual([]);
    expect(problemasDoGuia({ ...CAMISETAS, linhas: [{ tamanho: 'P', medidas: [96] }] })[0]).toContain('tem 1 medidas, mas a tabela tem 2');
    expect(problemasDoGuia({ ...CAMISETAS, linhas: [...CAMISETAS.linhas, { tamanho: 'p', medidas: [1, 2] }] })).toContain('tem tamanho repetido');
    expect(problemasDoGuia({ ...CAMISETAS, linhas: [{ tamanho: 'G', medidas: [0, 900] }] })[0]).toContain('em cm');
  });

  it('o guia do produto vale antes do da categoria', () => {
    const doProduto = { ...CAMISETAS, nome: 'Camiseta oversized' };
    const guias = [
      { itemId: null, categoriaId: 'camisetas', guia: CAMISETAS },
      { itemId: 'oversized', categoriaId: null, guia: doProduto },
    ];
    expect(guiaDoItem({ id: 'oversized', categoriaId: 'camisetas' }, guias)).toBe(doProduto);
    expect(guiaDoItem({ id: 'basica', categoriaId: 'camisetas' }, guias)).toBe(CAMISETAS);
    expect(guiaDoItem({ id: 'bone' }, guias)).toBeUndefined();
  });
});
