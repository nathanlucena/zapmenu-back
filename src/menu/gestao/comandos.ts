/**
 * Palavras-chave tratadas sem IA: funcionam mesmo com a IA fora do ar e não
 * gastam uma chamada para o óbvio. O resto da conversa é interpretado pela IA.
 */
export type Comando = 'CANCELAR' | 'CARDAPIO' | 'SIM' | 'NAO' | 'PENDENCIAS' | 'NAO_LEMBRAR';

const PALAVRAS: Record<Comando, string[]> = {
  CANCELAR: ['cancelar', 'cancela'],
  CARDAPIO: ['cardapio', 'ver cardapio', 'meu cardapio'],
  SIM: ['sim', 's', 'confirmar', 'confirmo', 'pode salvar', 'salvar', 'sim, pode salvar'],
  NAO: ['nao', 'n'],
  PENDENCIAS: [
    'o que falta',
    'oq falta',
    'o que ta faltando',
    'o que esta faltando',
    'falta o que',
    'falta alguma coisa',
    'cadastro',
    'meu cadastro',
    'status da loja',
  ],
  NAO_LEMBRAR: ['nao lembrar mais', 'nao quero lembrete', 'para de lembrar', 'pare de lembrar', 'sem lembrete'],
};

/**
 * Pedidos para ver o cardápio em formas comuns: "mostrar cardapio", "me mostra
 * o meu cardapio", "quero ver o cardapio atual"... (texto já normalizado).
 */
const PEDIDO_CARDAPIO =
  /^(?:(?:quero|queria|pode|me|por favor)\s+)*(?:ver|mostrar?|manda|mandar|envia|enviar|exibir?|exibe|listar?)?\s*(?:me\s+)?(?:o\s+)?(?:meu\s+)?cardapio(?:\s+atual)?(?:\s+por favor)?$/;

/** Minúsculas, sem acentos, sem pontuação final e com espaços simples. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.!?,]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function reconhecerComando(texto: string): Comando | undefined {
  const normalizado = normalizar(texto);
  if (PEDIDO_CARDAPIO.test(normalizado)) {
    return 'CARDAPIO';
  }
  for (const [comando, palavras] of Object.entries(PALAVRAS) as [Comando, string[]][]) {
    if (palavras.includes(normalizado)) {
      return comando;
    }
  }
  return undefined;
}
