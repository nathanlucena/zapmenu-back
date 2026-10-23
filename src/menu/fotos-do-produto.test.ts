import { describe, expect, it } from 'vitest';
import { fotosDoItem } from './fotos-do-produto.js';

describe('fotosDoItem', () => {
  it('ordena a galeria pela ordem, mantendo a de cadastro no empate', () => {
    const fotos = fotosDoItem([
      { url: 'costas.jpg', ordem: 2 },
      { url: 'frente.jpg', ordem: 0, cor: 'Azul' },
      { url: 'detalhe.jpg', ordem: 2 },
    ]);

    expect(fotos.map((foto) => foto.url)).toEqual(['frente.jpg', 'costas.jpg', 'detalhe.jpg']);
  });

  it('com galeria, ignora o imagemUrl', () => {
    expect(fotosDoItem([{ url: 'frente.jpg', ordem: 0 }], 'antiga.jpg')).toEqual([{ url: 'frente.jpg', ordem: 0 }]);
  });

  it('sem galeria, o imagemUrl vira a primeira foto', () => {
    expect(fotosDoItem([], 'bolo.jpg')).toEqual([{ url: 'bolo.jpg', ordem: 0 }]);
  });

  it('sem galeria nem imagem, não tem foto', () => {
    expect(fotosDoItem([])).toEqual([]);
  });
});
