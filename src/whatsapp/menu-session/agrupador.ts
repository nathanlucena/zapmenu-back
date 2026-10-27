/** Quanto silêncio espera depois de cada mensagem, e o teto desde a primeira. */
export interface OpcoesAgrupamento {
  silencioMs: number;
  maximoMs: number;
}

/**
 * Junta mensagens seguidas do mesmo telefone: espera `silencioMs` sem mensagem
 * nova (o relógio reinicia a cada uma), sem passar de `maximoMs` desde a
 * primeira, e entrega todas juntas. Assim "entrou pizza" + "de calabresa" +
 * "40 reais" viram uma rodada só da gestão.
 */
export function criarAgrupador<T>(opcoes: OpcoesAgrupamento, entregar: (chave: string, itens: T[]) => void) {
  const pendentes = new Map<string, { itens: T[]; inicio: number; timer: NodeJS.Timeout }>();

  function soltar(chave: string): void {
    const grupo = pendentes.get(chave);
    if (!grupo) return;
    pendentes.delete(chave);
    clearTimeout(grupo.timer);
    entregar(chave, grupo.itens);
  }

  return {
    adicionar(chave: string, item: T): void {
      const agora = Date.now();
      const grupo = pendentes.get(chave);
      if (grupo) clearTimeout(grupo.timer);
      const inicio = grupo?.inicio ?? agora;
      const espera = Math.max(0, Math.min(opcoes.silencioMs, inicio + opcoes.maximoMs - agora));
      pendentes.set(chave, {
        itens: [...(grupo?.itens ?? []), item],
        inicio,
        timer: setTimeout(() => soltar(chave), espera),
      });
    },
    /** Há mensagens deste telefone esperando o silêncio. */
    pendente: (chave: string) => pendentes.has(chave),
  };
}
