import { describe, expect, it } from 'vitest';
import { corDaPaleta, gerarSlug, nomeDaCor, normalizarCor, normalizarInstagram, PALETA_DA_LOJA, problemaNoSlug } from './vitrine.js';

describe('gerarSlug', () => {
  it('tira acentos, símbolos e espaços', () => {
    expect(gerarSlug('Pizzaria do Zé!')).toBe('pizzaria-do-ze');
    expect(gerarSlug('  Açaí & Cia  ')).toBe('acai-cia');
    expect(gerarSlug('🍕🍕')).toBe('');
  });
});

describe('problemaNoSlug', () => {
  it('aceita letras, números e hífens com pelo menos uma letra', () => {
    expect(problemaNoSlug('bolos-da-dona')).toBeNull();
    expect(problemaNoSlug('loja24h')).toBeNull();
  });

  it('recusa link curto demais, só com números ou com caracteres inválidos', () => {
    expect(problemaNoSlug('ab')).toContain('3 letras');
    expect(problemaNoSlug('5581999990000')).toContain('uma letra');
    expect(problemaNoSlug('bolo--da-dona')).toContain('hífens');
  });
});

describe('normalizarCor', () => {
  it('aceita hex de 3 ou 6 dígitos, com ou sem #', () => {
    expect(normalizarCor('#e53935')).toBe('#E53935');
    expect(normalizarCor('abc')).toBe('#AABBCC');
  });

  it('recusa o que não é hex', () => {
    expect(normalizarCor('vermelho')).toBeNull();
    expect(normalizarCor('#12345')).toBeNull();
  });
});

function contraste(a: string, b: string): number {
  const luminancia = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((inicio) => {
      const c = parseInt(hex.slice(inicio, inicio + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number];
  return (claro + 0.05) / (escuro + 0.05);
}

describe('paleta da loja', () => {
  it('toda cor tem contraste AA com o fundo claro do cardápio', () => {
    for (const cor of PALETA_DA_LOJA) {
      expect(contraste(cor.hex, '#F4F5F0'), cor.nome).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('entende nome, apelido e número da lista', () => {
    expect(corDaPaleta('Laranja')).toEqual({ cor: { nome: 'Laranja', hex: '#C2410C' }, aproximada: false });
    expect(corDaPaleta('amarelo')?.cor.nome).toBe('Mostarda');
    expect(corDaPaleta('lilás')?.cor.nome).toBe('Roxo');
    expect(corDaPaleta('5')?.cor.nome).toBe('Azul');
  });

  it('troca um hex qualquer pela cor da paleta mais parecida', () => {
    expect(corDaPaleta('#FFEB3B')).toEqual({ cor: { nome: 'Mostarda', hex: '#975C06' }, aproximada: true });
    expect(corDaPaleta('#87CEEB')?.cor.nome).toBe('Azul');
    expect(corDaPaleta('#E91E63')?.cor.nome).toBe('Rosa');
    expect(corDaPaleta('#F0F0F0')?.cor.nome).toBe('Preto');
    expect(corDaPaleta('#1f7a4d')).toEqual({ cor: { nome: 'Verde', hex: '#1F7A4D' }, aproximada: false });
  });

  it('recusa o que não é cor', () => {
    expect(corDaPaleta('bonita')).toBeNull();
    expect(corDaPaleta('9')).toBeNull();
  });

  it('mostra o nome da cor da paleta e o hex das cores antigas', () => {
    expect(nomeDaCor('#c62828')).toBe('Vermelho');
    expect(nomeDaCor('#E53935')).toBe('#E53935');
  });
});

describe('normalizarInstagram', () => {
  it('aceita @, link e perfil puro, sempre sem o @ e em minúsculas', () => {
    expect(normalizarInstagram('@Moda.Ana')).toBe('moda.ana');
    expect(normalizarInstagram('https://www.instagram.com/moda_ana/?hl=pt-br')).toBe('moda_ana');
    expect(normalizarInstagram('instagram.com/pizzariadoze')).toBe('pizzariadoze');
  });

  it('recusa o que não é perfil', () => {
    expect(normalizarInstagram('moda da ana')).toBeNull();
    expect(normalizarInstagram('@')).toBeNull();
    expect(normalizarInstagram('moda..ana')).toBeNull();
  });
});
