import { describe, expect, it } from 'vitest';
import { DomainError } from '../shared/errors/domain-error.js';
import { calcularPrecoUnitario } from './menu.service.js';
import type { ItemCardapio, Sku } from './menu.types.js';
import { descreverSku, escolhaDoSku, escolherSku } from './sku.js';

const M_AZUL: Sku = { id: 'sku-m-azul', tamanho: 'M', cor: 'Azul', estoque: 3, ativo: true };
const G_AZUL: Sku = { id: 'sku-g-azul', tamanho: 'G', cor: 'Azul', estoque: 0, preco: 75, ativo: true };
const P_PRETO: Sku = { id: 'sku-p-preto', tamanho: 'P', cor: 'Preto', estoque: 5, ativo: false };

const camiseta: ItemCardapio = {
  id: 'camiseta',
  cardapioId: 'cardapio-1',
  nome: 'Camiseta',
  precoBase: 60,
  ativo: true,
  variacoes: [],
  skus: [M_AZUL, G_AZUL, P_PRETO],
};

const bolo: ItemCardapio = { id: 'bolo', cardapioId: 'cardapio-1', nome: 'Bolo', precoBase: 25, ativo: true, variacoes: [], skus: [] };

function erroDe(acao: () => unknown): DomainError {
  try {
    acao();
  } catch (erro) {
    return erro as DomainError;
  }
  throw new Error('deveria ter lançado');
}

describe('descreverSku', () => {
  it('fala o tamanho e a cor como o cliente fala', () => {
    expect(descreverSku(M_AZUL)).toBe('Tamanho M azul');
    expect(descreverSku({ tamanho: 'G' })).toBe('Tamanho G');
    expect(descreverSku({ cor: 'preto' })).toBe('Preto');
    expect(descreverSku({})).toBe('Opção única');
  });
});

describe('escolherSku', () => {
  it('item sem SKU (comida) segue sem escolha', () => {
    expect(escolherSku(bolo, undefined, 10)).toBeUndefined();
  });

  it('item sem SKU não aceita um skuId', () => {
    expect(erroDe(() => escolherSku(bolo, 'sku-m-azul', 1)).code).toBe('SKU_INVALIDO');
  });

  it('devolve o SKU com estoque suficiente', () => {
    expect(escolherSku(camiseta, 'sku-m-azul', 3)).toBe(M_AZUL);
  });

  it('item com SKU exige a escolha', () => {
    const erro = erroDe(() => escolherSku(camiseta, undefined, 1));
    expect(erro.code).toBe('SKU_OBRIGATORIO');
    expect(erro.message).toBe('Escolha o tamanho e a cor de "Camiseta".');
  });

  it('recusa SKU de outro item ou pausado', () => {
    expect(erroDe(() => escolherSku(camiseta, 'sku-de-outro-item', 1)).code).toBe('SKU_INVALIDO');
    expect(erroDe(() => escolherSku(camiseta, 'sku-p-preto', 1)).code).toBe('SKU_INVALIDO');
  });

  it('avisa quando o tamanho/cor esgotou', () => {
    const erro = erroDe(() => escolherSku(camiseta, 'sku-g-azul', 1));
    expect(erro.code).toBe('SKU_ESGOTADO');
    expect(erro.message).toBe('Tamanho G azul esgotado em "Camiseta".');
  });

  it('avisa quantas unidades restam quando o pedido passa do estoque', () => {
    const erro = erroDe(() => escolherSku(camiseta, 'sku-m-azul', 4));
    expect(erro.code).toBe('SKU_ESGOTADO');
    expect(erro.message).toBe('Tamanho M azul de "Camiseta": só restam 3 unidades.');
  });
});

describe('escolhaDoSku', () => {
  it('guarda só o que o SKU tem', () => {
    expect(escolhaDoSku(M_AZUL)).toEqual({ Tamanho: 'M', Cor: 'Azul' });
    expect(escolhaDoSku({ cor: 'Preto' })).toEqual({ Cor: 'Preto' });
  });
});

describe('calcularPrecoUnitario com SKU', () => {
  it('o preço do SKU substitui o precoBase', () => {
    expect(calcularPrecoUnitario(camiseta, {}, G_AZUL)).toBe(75);
  });

  it('SKU sem preço usa o precoBase', () => {
    expect(calcularPrecoUnitario(camiseta, {}, M_AZUL)).toBe(60);
  });
});
