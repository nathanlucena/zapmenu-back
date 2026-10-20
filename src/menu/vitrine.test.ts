import { describe, expect, it } from 'vitest';
import { gerarSlug, normalizarCor, problemaNoSlug } from './vitrine.js';

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
