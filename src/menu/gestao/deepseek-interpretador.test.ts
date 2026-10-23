import { describe, expect, it } from 'vitest';
import { interpretarRespostaDaIA, RespostaInvalidaDaIA } from './deepseek-interpretador.js';

describe('interpretarRespostaDaIA', () => {
  it('converte as operações do formato da IA para o contrato da conversa', () => {
    const saida = interpretarRespostaDaIA(
      JSON.stringify({
        resposta: ' Anotei! ',
        operacoes: [
          {
            tipo: 'novo_item',
            ref: 'n1',
            nome: 'Pizza',
            preco: '40,50',
            categoria: 'Pizzas',
            variacoes: [{ nome: 'Tamanho', opcoes: [{ nome: 'G', preco_adicional: 10 }] }],
          },
          { tipo: 'pausar_item', item_id: 'i1' },
        ],
        finalizou: true,
      }),
    );

    expect(saida.resposta).toBe('Anotei!');
    expect(saida.finalizou).toBe(true);
    expect(saida.mostrarCardapio).toBe(false);
    expect(saida.operacoes).toEqual([
      {
        tipo: 'NOVO_ITEM',
        ref: 'n1',
        dados: {
          nome: 'Pizza',
          descricao: undefined,
          precoBase: 40.5,
          categoria: 'Pizzas',
          variacoes: [{ nome: 'Tamanho', opcoes: [{ nome: 'G', precoAdicional: 10 }] }],
        },
      },
      { tipo: 'PAUSAR_ITEM', itemId: 'i1' },
    ]);
    expect(saida.operacoesMalformadas).toEqual([]);
  });

  it('separa operações malformadas ou desconhecidas sem derrubar as válidas', () => {
    const saida = interpretarRespostaDaIA(
      JSON.stringify({
        operacoes: [
          { tipo: 'pausar_item', item_id: 'i1' },
          { tipo: 'pausar_item' },
          { tipo: 'apagar_tudo_do_banco' },
          { tipo: 'novo_item', nome: 'Bolo', preco: -5 },
        ],
      }),
    );

    expect(saida.operacoes).toEqual([{ tipo: 'PAUSAR_ITEM', itemId: 'i1' }]);
    expect(saida.operacoesMalformadas).toHaveLength(3);
  });

  it('entende o frete do envio pelos Correios', () => {
    const saida = interpretarRespostaDaIA(
      JSON.stringify({
        operacoes: [{ tipo: 'atualizar_loja', aceita_envio: true, frete_envio: '25,00', frete_por_uf: { pe: 12, PB: '15' } }],
      }),
    );

    expect(saida.operacoes[0]).toMatchObject({
      tipo: 'ATUALIZAR_LOJA',
      dados: { aceitaEnvio: true, freteEnvio: 25, fretePorUf: { PE: 12, PB: 15 } },
    });
  });

  it('preenche os campos ausentes com valores neutros', () => {
    const saida = interpretarRespostaDaIA('{}');

    expect(saida).toEqual({
      resposta: '',
      operacoes: [],
      operacoesMalformadas: [],
      finalizou: false,
      mostrarCardapio: false,
      decisao: undefined,
    });
  });

  it('entende a decisão no resumo', () => {
    expect(interpretarRespostaDaIA('{"decisao":"Confirmar"}').decisao).toBe('CONFIRMAR');
    expect(interpretarRespostaDaIA('{"decisao":"recusar"}').decisao).toBe('RECUSAR');
    expect(interpretarRespostaDaIA('{"decisao":"talvez"}').decisao).toBeUndefined();
  });

  it('recusa resposta vazia, JSON inválido ou fora do formato', () => {
    expect(() => interpretarRespostaDaIA('')).toThrow(RespostaInvalidaDaIA);
    expect(() => interpretarRespostaDaIA(null)).toThrow(RespostaInvalidaDaIA);
    expect(() => interpretarRespostaDaIA('não é json')).toThrow(RespostaInvalidaDaIA);
    expect(() => interpretarRespostaDaIA('{"operacoes":"nao-e-lista"}')).toThrow(RespostaInvalidaDaIA);
  });
});
