/**
 * Palavras-chave tratadas sem IA: funcionam mesmo com a IA fora do ar e não
 * gastam uma chamada para o óbvio. O resto da conversa é interpretado pela IA.
 */
export type Comando = 'CANCELAR' | 'CARDAPIO' | 'SIM' | 'NAO' | 'PENDENCIAS' | 'NAO_LEMBRAR' | 'PREVIA' | 'MUDAR_TIPO';

const PALAVRAS: Record<Comando, string[]> = {
  CANCELAR: ['cancelar', 'cancela'],
  CARDAPIO: ['cardapio', 'ver cardapio', 'meu cardapio', 'catalogo', 'ver catalogo', 'meu catalogo', 'meus produtos', 'ver produtos'],
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
  PREVIA: [
    'como vai ficar',
    'como fica',
    'como ficou',
    'como vai ficar no cardapio',
    'ver previa',
    'mostrar previa',
    'mostra como fica',
    'mostra como vai ficar',
    'previa',
  ],
  MUDAR_TIPO: [
    'mudar tipo da loja',
    'mudar o tipo da loja',
    'trocar tipo da loja',
    'trocar o tipo da loja',
    'mudar tipo',
    'trocar tipo',
    'mudar o tipo',
    'trocar o tipo',
    'tipo da loja',
  ],
  NAO_LEMBRAR: ['nao lembrar mais', 'nao quero lembrete', 'para de lembrar', 'pare de lembrar', 'sem lembrete'],
};

/**
 * Pedidos para ver o cardápio em formas comuns: "mostrar cardapio", "me mostra
 * o meu cardapio", "quero ver o cardapio atual"... (texto já normalizado).
 */
const PEDIDO_CARDAPIO =
  /^(?:(?:quero|queria|pode|me|por favor)\s+)*(?:ver|mostrar?|manda|mandar|envia|enviar|exibir?|exibe|listar?)?\s*(?:me\s+)?(?:o\s+)?(?:meu\s+)?(?:cardapio|catalogo)(?:\s+atual)?(?:\s+por favor)?$/;

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

export type PlanoDoComando = 'ESSENCIAL' | 'PROFISSIONAL';

/** Comandos da assinatura do ZapMenu, também sem IA. "regularizar" é assinar de novo o plano atual. */
export type ComandoDePlano =
  | { tipo: 'MEU_PLANO' }
  | { tipo: 'ASSINAR'; plano?: PlanoDoComando; periodo?: 'MENSAL' | 'ANUAL'; regularizar?: boolean }
  | { tipo: 'MUDAR_PLANO'; plano?: PlanoDoComando }
  | { tipo: 'CANCELAR_ASSINATURA' };

const NOME_DO_PLANO = '(?:o\\s+)?(?:plano\\s+)?(basico|essencial|profissional|pro)';
const PLANO_DA_PALAVRA: Record<string, PlanoDoComando> = {
  basico: 'ESSENCIAL',
  essencial: 'ESSENCIAL',
  profissional: 'PROFISSIONAL',
  pro: 'PROFISSIONAL',
};

const MEU_PLANO = /^(?:(?:qual\s+(?:e\s+)?|ver\s+)?(?:o\s+)?meu\s+plano|minha\s+assinatura|meu\s+plano\s+atual|qual\s+plano\s+(?:eu\s+)?(?:tenho|estou))$/;
const CANCELAR_ASSINATURA = /^cancelar\s+(?:a\s+|minha\s+)?assinatura$/;
const ASSINAR = new RegExp(`^(?:quero\\s+)?(?:assinar|assina)(?:\\s+${NOME_DO_PLANO})?(?:\\s+(anual|mensal))?$`);
const REGULARIZAR = /^(?:quero\s+)?(?:regularizar|pagar\s+(?:a\s+)?assinatura|atualizar\s+(?:o\s+)?cartao)$/;
const MUDAR_PLANO = new RegExp(`^(?:quero\\s+)?(?:mudar|trocar)\\s+(?:de\\s+|o\\s+|meu\\s+)?plano(?:\\s+(?:para|pro)\\s+${NOME_DO_PLANO})?$`);
const MUDAR_PARA = new RegExp(`^(?:quero\\s+)?(?:mudar|trocar|passar)\\s+(?:para|pro)\\s+${NOME_DO_PLANO}$`);

export function reconhecerComandoDePlano(texto: string): ComandoDePlano | undefined {
  const normalizado = normalizar(texto);
  if (MEU_PLANO.test(normalizado)) {
    return { tipo: 'MEU_PLANO' };
  }
  if (CANCELAR_ASSINATURA.test(normalizado)) {
    return { tipo: 'CANCELAR_ASSINATURA' };
  }
  if (REGULARIZAR.test(normalizado)) {
    return { tipo: 'ASSINAR', regularizar: true };
  }
  const assinar = normalizado.match(ASSINAR);
  if (assinar) {
    const [, plano, periodo] = assinar;
    return {
      tipo: 'ASSINAR',
      plano: plano ? PLANO_DA_PALAVRA[plano] : undefined,
      periodo: periodo === 'anual' ? 'ANUAL' : periodo === 'mensal' ? 'MENSAL' : undefined,
    };
  }
  const mudar = normalizado.match(MUDAR_PLANO) ?? normalizado.match(MUDAR_PARA);
  if (mudar) {
    return { tipo: 'MUDAR_PLANO', plano: mudar[1] ? PLANO_DA_PALAVRA[mudar[1]] : undefined };
  }
  return undefined;
}

/** Comandos das promoções, sem IA. `numero` é a posição em "minhas promoções". */
export type ComandoDePromocao =
  | { tipo: 'LISTAR' }
  | { tipo: 'PAUSAR' | 'REATIVAR' | 'REMOVER'; numero: number };

const LISTAR_PROMOCOES = /^(?:(?:ver|listar|mostrar?|quais)\s+)?(?:as\s+)?(?:minhas\s+)?promocoes(?:\s+ativas)?$/;
const ACAO_PROMOCAO = /^(pausar|parar|suspender|reativar|ativar|voltar|remover|apagar|excluir|cancelar)\s+(?:a\s+)?promocao\s+(?:n(?:umero|o|º)?\s*)?(\d+)$/;

export function reconhecerComandoDePromocao(texto: string): ComandoDePromocao | undefined {
  const normalizado = normalizar(texto);
  if (LISTAR_PROMOCOES.test(normalizado)) {
    return { tipo: 'LISTAR' };
  }
  const acao = normalizado.match(ACAO_PROMOCAO);
  if (!acao) {
    return undefined;
  }
  const [, verbo = '', numero = '0'] = acao;
  const tipo = ['pausar', 'parar', 'suspender'].includes(verbo)
    ? 'PAUSAR'
    : ['reativar', 'ativar', 'voltar'].includes(verbo)
      ? 'REATIVAR'
      : 'REMOVER';
  return { tipo, numero: Number(numero) };
}
