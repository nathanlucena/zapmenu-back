import type { GeradorDeDescricoes, ProdutoParaDescrever } from '../gerador-de-descricoes.js';

/** IA de descrições simulada: devolve duas opções previsíveis e guarda o que foi pedido. */
export function criarGeradorDeDescricoesFake() {
  const pedidos: ProdutoParaDescrever[] = [];
  const fake: GeradorDeDescricoes & { pedidos: ProdutoParaDescrever[]; falhar: boolean } = {
    pedidos,
    falhar: false,
    async sugerir(produto) {
      pedidos.push(produto);
      if (fake.falhar) throw new Error('IA fora do ar');
      return [`${produto.nome} feita na hora, do jeito que você gosta.`, `Peça a ${produto.nome} e receba quentinha.`];
    },
  };
  return fake;
}
