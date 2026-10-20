import type { EntradaConversa, InterpretadorMensagem, RespostaConversa } from '../interpretador.js';

export interface InterpretadorRoteiroFake extends InterpretadorMensagem {
  /** Enfileira a próxima resposta da IA; campos omitidos ficam vazios. */
  responder(resposta: Partial<RespostaConversa>): void;
  entradas: EntradaConversa[];
}

/** IA de mentira: devolve as respostas roteirizadas, uma por chamada, na ordem. */
export function criarInterpretadorRoteiroFake(): InterpretadorRoteiroFake {
  const roteiro: RespostaConversa[] = [];
  const entradas: EntradaConversa[] = [];

  return {
    entradas,
    responder(resposta) {
      roteiro.push({
        resposta: '',
        operacoes: [],
        operacoesMalformadas: [],
        finalizou: false,
        mostrarCardapio: false,
        ...resposta,
      });
    },
    async conversar(entrada) {
      entradas.push(structuredClone(entrada));
      const proxima = roteiro.shift();
      if (!proxima) {
        throw new Error('O roteiro da IA acabou: o teste chamou a IA mais vezes do que esperava.');
      }
      return proxima;
    },
  };
}
