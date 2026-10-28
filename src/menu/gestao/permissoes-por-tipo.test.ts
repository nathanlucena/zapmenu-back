import { describe, expect, it } from 'vitest';
import { promptDoSistema, interpretarRespostaDaIA } from './deepseek-interpretador.js';
import type { Operacao } from './interpretador.js';
import { AVISO_SO_DA_LOJA, AVISO_SO_DO_CARDAPIO, filtrarPorTipo } from './permissoes-por-tipo.js';
import { descreverGrade, validarGrade } from './rascunho.js';

const TAMANHOS = [{ nome: 'Tamanho', opcoes: [{ nome: 'G', precoAdicional: 10 }] }];
const GRADE: Operacao = { tipo: 'DEFINIR_GRADE', ref: 'n1', grade: [{ tamanho: 'M', cor: 'Azul', estoque: 3 }] };

describe('filtrarPorTipo', () => {
  it('cardápio: recusa grade, envio e política de troca, mantendo o resto da operação', () => {
    const saida = filtrarPorTipo('COMIDA', [
      GRADE,
      { tipo: 'ATUALIZAR_LOJA', dados: { nome: 'Pizzaria', usaMelhorEnvio: true, politicaTroca: 'troca' } },
      { tipo: 'ATUALIZAR_LOJA', dados: { cepOrigem: '50050000' } },
      { tipo: 'NOVO_ITEM', ref: 'n2', dados: { nome: 'Pizza', variacoes: TAMANHOS } },
    ]);

    expect(saida.operacoes).toEqual([
      { tipo: 'ATUALIZAR_LOJA', dados: { nome: 'Pizzaria' } },
      { tipo: 'NOVO_ITEM', ref: 'n2', dados: { nome: 'Pizza', variacoes: TAMANHOS } },
    ]);
    expect(saida.avisos).toEqual([AVISO_SO_DA_LOJA]);
  });

  it('cardápio sem tipo gravado (lojas antigas) se comporta como comida', () => {
    expect(filtrarPorTipo(undefined, [GRADE]).operacoes).toEqual([]);
  });

  it('loja: recusa adicionais, mas aceita o produto, a grade, o envio e a política de troca', () => {
    const saida = filtrarPorTipo('VAREJO', [
      { tipo: 'NOVO_ITEM', ref: 'n1', dados: { nome: 'Camiseta', precoBase: 59.9, variacoes: TAMANHOS } },
      { tipo: 'EDITAR_ITEM', itemId: 'i1', dados: { variacoes: TAMANHOS } },
      GRADE,
      { tipo: 'ATUALIZAR_LOJA', dados: { usaMelhorEnvio: true, cepOrigem: '50050000', politicaTroca: 'Troca em 7 dias' } },
    ]);

    expect(saida.operacoes).toEqual([
      { tipo: 'NOVO_ITEM', ref: 'n1', dados: { nome: 'Camiseta', precoBase: 59.9 } },
      { tipo: 'EDITAR_ITEM', itemId: 'i1', dados: {} },
      GRADE,
      { tipo: 'ATUALIZAR_LOJA', dados: { usaMelhorEnvio: true, cepOrigem: '50050000', politicaTroca: 'Troca em 7 dias' } },
    ]);
    expect(saida.avisos).toEqual([AVISO_SO_DO_CARDAPIO]);
  });
});

describe('grade', () => {
  it('arruma a grade: estoque inteiro, sem repetição, sem linha vazia', () => {
    const { grade, avisos } = validarGrade([
      { tamanho: 'm', cor: 'azul', estoque: 3.7 },
      { tamanho: 'M', cor: 'Azul', estoque: 5 },
      { estoque: 2 },
      { tamanho: 'G', cor: 'azul', estoque: -1, preco: 69.9 },
    ]);

    expect(grade).toEqual([
      { tamanho: 'M', cor: 'Azul', estoque: 5 },
      { tamanho: 'G', cor: 'Azul', estoque: 0, preco: 69.9 },
    ]);
    expect(avisos).toHaveLength(1);
    expect(descreverGrade(grade)).toBe('M Azul 5 · G Azul esgotado (R$ 69,90)');
  });

  it('a IA manda definir_grade e vira a operação da conversa', () => {
    const saida = interpretarRespostaDaIA(
      JSON.stringify({
        operacoes: [{ tipo: 'definir_grade', item_id: 'i1', grade: [{ tamanho: 38, cor: 'Preto', estoque: '2' }] }],
      }),
    );

    expect(saida.operacoes).toEqual([{ tipo: 'DEFINIR_GRADE', ref: undefined, itemId: 'i1', grade: [{ tamanho: '38', cor: 'Preto', estoque: 2, preco: undefined }] }]);
  });
});

describe('promptDoSistema', () => {
  it('cada tipo só conhece as próprias ações', () => {
    const cardapio = promptDoSistema('COMIDA');
    const loja = promptDoSistema('VAREJO');

    expect(cardapio).toContain('TIPO DA LOJA: CARDÁPIO');
    expect(cardapio).toContain('Nunca use definir_grade');
    expect(cardapio).not.toContain('"tipo": "definir_grade", "ref"');
    expect(loja).toContain('TIPO DA LOJA: LOJA');
    expect(loja).toContain('NUNCA use variacoes');
    expect(loja).not.toContain('preco_adicional": 15');
  });
});
