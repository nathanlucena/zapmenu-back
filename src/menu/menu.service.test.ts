import { describe, expect, it } from 'vitest';
import { criarMenuRepositoryFake } from './__mocks__/menu.repository.fake.js';
import { criarItem, montarPreview, validarItemDraft, validarVariacao } from './menu.service.js';
import type { ItemDraft, VariacaoInput } from './menu.types.js';

function draftValido(overrides: Partial<ItemDraft> = {}): ItemDraft {
  return {
    nome: 'Bolo de cenoura',
    descricao: 'Com cobertura de chocolate',
    precoBase: 25,
    variacoes: [],
    ...overrides,
  };
}

describe('validarVariacao', () => {
  it('aceita variação com nome e opções válidas', () => {
    const variacao: VariacaoInput = {
      nome: 'Tamanho',
      opcoes: [{ nome: 'P', precoAdicional: 0 }, { nome: 'G', precoAdicional: 5 }],
    };
    expect(validarVariacao(variacao)).toEqual([]);
  });

  it('rejeita variação sem nome', () => {
    const erros = validarVariacao({ nome: '  ', opcoes: [{ nome: 'P', precoAdicional: 0 }] });
    expect(erros).toContain('Variação precisa de um nome (ex: "Tamanho").');
  });

  it('rejeita variação sem opções', () => {
    const erros = validarVariacao({ nome: 'Tamanho', opcoes: [] });
    expect(erros).toContain('Variação "Tamanho" precisa de ao menos uma opção.');
  });

  it('rejeita opção com preço adicional negativo', () => {
    const erros = validarVariacao({ nome: 'Tamanho', opcoes: [{ nome: 'P', precoAdicional: -1 }] });
    expect(erros).toContain('Opção "P" não pode ter preço adicional negativo.');
  });
});

describe('validarItemDraft', () => {
  it('aceita draft válido sem variações', () => {
    expect(validarItemDraft(draftValido())).toEqual([]);
  });

  it('rejeita item sem nome', () => {
    const erros = validarItemDraft(draftValido({ nome: '' }));
    expect(erros).toContain('Item precisa de um nome.');
  });

  it('rejeita preço base negativo', () => {
    const erros = validarItemDraft(draftValido({ precoBase: -10 }));
    expect(erros).toContain('Preço base não pode ser negativo.');
  });

  it('acumula erros de variações inválidas', () => {
    const erros = validarItemDraft(
      draftValido({ variacoes: [{ nome: '', opcoes: [] }] }),
    );
    expect(erros.length).toBeGreaterThan(1);
  });
});

describe('montarPreview', () => {
  it('inclui nome, descrição e preço', () => {
    const preview = montarPreview(draftValido());
    expect(preview).toContain('*Bolo de cenoura*');
    expect(preview).toContain('Com cobertura de chocolate');
    expect(preview).toContain('Preço: R$ 25.00');
  });

  it('formata variações com preço adicional só quando maior que zero', () => {
    const preview = montarPreview(
      draftValido({
        variacoes: [{ nome: 'Tamanho', opcoes: [{ nome: 'P', precoAdicional: 0 }, { nome: 'G', precoAdicional: 5 }] }],
      }),
    );
    expect(preview).toContain('Tamanho: P, G (+R$ 5.00)');
  });

  it('sinaliza imagem anexada quando presente', () => {
    const preview = montarPreview(draftValido({ imagemUrl: 'https://example.com/bolo.jpg' }));
    expect(preview).toContain('[imagem anexada]');
  });
});

describe('criarItem', () => {
  it('cria o cardápio do empreendedor na primeira chamada e reutiliza depois', async () => {
    const repositorio = criarMenuRepositoryFake();

    const item1 = await criarItem(repositorio, 'emp-1', draftValido({ nome: 'Bolo' }));
    const item2 = await criarItem(repositorio, 'emp-1', draftValido({ nome: 'Torta' }));

    expect(item1.cardapioId).toBe(item2.cardapioId);
  });

  it('lança DomainError quando o draft é inválido', async () => {
    const repositorio = criarMenuRepositoryFake();
    await expect(criarItem(repositorio, 'emp-1', draftValido({ nome: '' }))).rejects.toThrow(
      'Item precisa de um nome.',
    );
  });

  it('item criado aparece na listagem de itens ativos', async () => {
    const repositorio = criarMenuRepositoryFake();
    const item = await criarItem(repositorio, 'emp-1', draftValido());
    const cardapio = await repositorio.obterOuCriarCardapio('emp-1');
    const itens = await repositorio.listarItensAtivos(cardapio.id);
    expect(itens).toContainEqual(item);
  });
});
