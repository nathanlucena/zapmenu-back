import { describe, expect, it } from 'vitest';
import type { Promocao } from '../promocoes/domain/promocao.js';
import { calcularPrecoUnitario } from './menu.service.js';
import type { ItemCardapio } from './menu.types.js';
import { comPromocoes } from './promocoes-na-vitrine.js';

const FUSO = 'America/Sao_Paulo';
const QUARTA_20H = new Date('2026-10-28T23:00:00Z');
const TERCA_20H = new Date('2026-10-27T23:00:00Z');
const PROFISSIONAL = { plano: 'PROFISSIONAL', status: 'ATIVA' } as const;
const BASICO = { plano: 'ESSENCIAL', status: 'ATIVA' } as const;

const CALABRESA: ItemCardapio = {
  id: 'calabresa',
  cardapioId: 'c1',
  categoriaId: 'pizzas',
  nome: 'Calabresa',
  precoBase: 50,
  ativo: true,
  variacoes: [{ nome: 'Tamanho', opcoes: [{ nome: 'M', precoAdicional: 0 }, { nome: 'G', precoAdicional: 15 }] }],
};

const QUARTA_DA_CALABRESA: Promocao = {
  id: 'p1',
  lojaId: 'loja-1',
  tipo: 'PRECO_FIXO',
  valor: 39.9,
  diasSemana: [3],
  ativa: true,
  alvo: { tipo: 'ITENS', ids: ['calabresa'] },
  criadaEm: new Date('2026-10-01T12:00:00Z'),
};

describe('promoções na vitrine e no preço do pedido', () => {
  it('no dia da promoção, o item leva o preço promocional e o selo; o precoBase fica intacto', () => {
    const [item] = comPromocoes([CALABRESA], [QUARTA_DA_CALABRESA], PROFISSIONAL, QUARTA_20H, FUSO);
    expect(item!.promocao).toMatchObject({ precoPromocional: 39.9, rotulo: 'Promoção de quarta' });
    expect(item!.precoBase).toBe(50);
  });

  it('fora do dia, o preço normal', () => {
    const [item] = comPromocoes([CALABRESA], [QUARTA_DA_CALABRESA], PROFISSIONAL, TERCA_20H, FUSO);
    expect(item!.promocao).toBeUndefined();
  });

  it('no Básico, a promoção fica guardada mas não vale', () => {
    const [item] = comPromocoes([CALABRESA], [QUARTA_DA_CALABRESA], BASICO, QUARTA_20H, FUSO);
    expect(item!.promocao).toBeUndefined();
  });

  it('o pedido cobra a promoção e as variações somam o acréscimo normal', () => {
    const [item] = comPromocoes([CALABRESA], [QUARTA_DA_CALABRESA], PROFISSIONAL, QUARTA_20H, FUSO);
    expect(calcularPrecoUnitario(item!, { Tamanho: 'M' })).toBe(39.9);
    expect(calcularPrecoUnitario(item!, { Tamanho: 'G' })).toBe(54.9);
    expect(calcularPrecoUnitario(CALABRESA, { Tamanho: 'G' })).toBe(65);
  });

  it('percentual vale também sobre o preço próprio do tamanho/cor', () => {
    const camiseta: ItemCardapio = { ...CALABRESA, id: 'camiseta', variacoes: [] };
    const dez: Promocao = { ...QUARTA_DA_CALABRESA, id: 'p2', tipo: 'PERCENTUAL', valor: 10, diasSemana: [], alvo: { tipo: 'LOJA' } };
    const [item] = comPromocoes([camiseta], [dez], PROFISSIONAL, QUARTA_20H, FUSO);
    expect(calcularPrecoUnitario(item!, {}, { preco: 79.9 })).toBe(71.91);
  });
});
