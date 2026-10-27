/**
 * Palavras-chave tratadas sem IA: funcionam mesmo com a IA fora do ar e não
 * gastam uma chamada para o óbvio. O resto da conversa é interpretado pela IA.
 */
export type Comando =
  | 'CANCELAR'
  | 'CARDAPIO'
  | 'SIM'
  | 'NAO'
  | 'PENDENCIAS'
  | 'NAO_LEMBRAR'
  | 'PREVIA'
  | 'MUDAR_TIPO'
  | 'TIRAR_CAPA'
  | 'TIRAR_LOGO';

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
  TIRAR_CAPA: ['tirar a capa', 'tirar capa', 'remover a capa', 'remover capa', 'apagar a capa', 'sem capa'],
  TIRAR_LOGO: ['tirar o logo', 'tirar a logo', 'tirar logo', 'remover o logo', 'remover a logo', 'remover logo', 'apagar o logo', 'sem logo'],
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

/** Relatório de vendas pedido na conversa, e o liga/desliga do diário. */
export type ComandoDeRelatorio = 'SEMANA' | 'MES' | 'HOJE' | 'ONTEM' | 'PARAR_DIARIO' | 'LIGAR_DIARIO';

const PALAVRAS_DE_RELATORIO: Record<ComandoDeRelatorio, string[]> = {
  SEMANA: ['relatorio', 'meu relatorio', 'relatorio da semana', 'relatorio semanal', 'vendas da semana', 'relatorio de vendas'],
  MES: ['relatorio do mes', 'relatorio mensal', 'vendas do mes'],
  HOJE: ['vendas de hoje', 'vendas hoje', 'relatorio de hoje', 'quanto vendi hoje'],
  ONTEM: ['vendas de ontem', 'relatorio de ontem'],
  PARAR_DIARIO: ['parar relatorio diario', 'desligar relatorio diario', 'nao quero relatorio diario', 'parar o relatorio diario'],
  LIGAR_DIARIO: ['voltar relatorio diario', 'ligar relatorio diario', 'quero relatorio diario', 'voltar o relatorio diario'],
};

export function reconhecerComandoDeRelatorio(texto: string): ComandoDeRelatorio | undefined {
  const normalizado = normalizar(texto);
  return (Object.entries(PALAVRAS_DE_RELATORIO) as [ComandoDeRelatorio, string[]][]).find(([, palavras]) =>
    palavras.includes(normalizado),
  )?.[0];
}

/** Mensagem que a gestão responde sem IA (sim, cancelar, o que falta, meu plano…): sozinha, responde na hora. */
export function ehComandoSemIA(texto: string): boolean {
  return Boolean(
    reconhecerComando(texto) ||
      reconhecerComandoDePlano(texto) ||
      reconhecerComandoDePromocao(texto) ||
      reconhecerComandoDeRelatorio(texto) ||
      reconhecerComandoDeDescricao(texto),
  );
}

/** Pedido de descrição escrita pela IA: de um item (pelo nome) ou de uma categoria. */
export type ComandoDeDescricao = { tipo: 'ITEM' | 'CATEGORIA'; nome: string };

const DESCRICAO_DA_CATEGORIA = /^(?:melhor(?:a|ar)|escreve(?:r)?|cria(?:r)?)\s+(?:as\s+)?descricoes\s+(?:da|do|de|dos|das)\s+categoria\s+(.+)$/;
const DESCRICAO_DO_ITEM = /^(?:melhor(?:a|ar)|escreve(?:r)?|cria(?:r)?)\s+(?:a\s+|uma\s+)?descricao\s+(?:da|do|de|para|pra|pro)\s+(?:a\s+|o\s+)?(.+)$/;

export function reconhecerComandoDeDescricao(texto: string): ComandoDeDescricao | undefined {
  const normalizado = normalizar(texto);
  const categoria = normalizado.match(DESCRICAO_DA_CATEGORIA);
  if (categoria) return { tipo: 'CATEGORIA', nome: categoria[1]!.trim() };
  const item = normalizado.match(DESCRICAO_DO_ITEM);
  if (item) return { tipo: 'ITEM', nome: item[1]!.trim() };
  return undefined;
}
