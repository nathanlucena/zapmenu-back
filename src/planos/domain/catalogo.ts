/**
 * Catálogo dos planos do ZapMenu: preço, limites e recursos. É a única fonte
 * desses números; mudar um preço é mudar uma linha aqui.
 *
 * Sem imports de propósito: a landing (zapmenu-front) guarda uma cópia deste
 * arquivo em src/features/landing/catalogo-planos.ts. Ao mudar aqui, copie lá.
 */

export const RECURSOS = [
  'CARTAO',
  'AUDIO',
  'IA_DESCRICAO',
  'PROMOCOES',
  'DESCONTO_PERCENTUAL',
  'CORES_CAPA',
  'ENTREGA_POR_DISTANCIA',
  'MELHOR_ENVIO',
  'GUIA_MEDIDAS',
  'RELATORIO_SEMANAL',
  'RELATORIO_DIARIO',
  'SEM_SELO',
  'PREVIA_IMAGEM',
] as const;

export type Recurso = (typeof RECURSOS)[number];

export const PLANOS_IDS = ['ESSENCIAL', 'PROFISSIONAL'] as const;
export type PlanoId = (typeof PLANOS_IDS)[number];

/** null = ilimitado. */
export interface LimitesDoPlano {
  pedidosMes: number | null;
  produtos: number | null;
  minutosAudioMes: number | null;
  sugestoesIaMes: number | null;
}

export type ChaveLimite = keyof LimitesDoPlano;

export interface Plano {
  id: PlanoId;
  /** Nome mostrado ao lojista. */
  nome: string;
  /** Preço do mês no plano mensal, em centavos. */
  precoMensalCentavos: number;
  /** Preço de cada mês no plano anual, em centavos (cobrado de uma vez: x 12). */
  precoAnualPorMesCentavos: number;
  limites: LimitesDoPlano;
  recursos: Record<Recurso, boolean>;
}

function recursos(ligados: 'TODOS' | 'NENHUM'): Record<Recurso, boolean> {
  return Object.fromEntries(RECURSOS.map((recurso) => [recurso, ligados === 'TODOS'])) as Record<Recurso, boolean>;
}

export const CATALOGO_PLANOS: Record<PlanoId, Plano> = {
  ESSENCIAL: {
    id: 'ESSENCIAL',
    nome: 'Básico',
    precoMensalCentavos: 2999,
    precoAnualPorMesCentavos: 2499,
    limites: { pedidosMes: 100, produtos: 30, minutosAudioMes: 0, sugestoesIaMes: 0 },
    recursos: recursos('NENHUM'),
  },
  PROFISSIONAL: {
    id: 'PROFISSIONAL',
    nome: 'Profissional',
    precoMensalCentavos: 5999,
    precoAnualPorMesCentavos: 4999,
    limites: { pedidosMes: 1500, produtos: null, minutosAudioMes: 60, sugestoesIaMes: 100 },
    recursos: recursos('TODOS'),
  },
};

/** Loja nova testa este plano de graça por DIAS_DE_TESTE dias. */
export const PLANO_DO_TESTE: PlanoId = 'PROFISSIONAL';
export const DIAS_DE_TESTE = 14;
