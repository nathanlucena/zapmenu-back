import { DomainError } from '../../shared/errors/domain-error.js';
import { UM_DIA_MS, diaNoFuso } from './calendario.js';
import {
  CATALOGO_PLANOS,
  DIAS_DE_TESTE,
  PLANO_DO_TESTE,
  type ChaveLimite,
  type PlanoId,
  type Recurso,
} from './catalogo.js';

export type PeriodoAssinatura = 'MENSAL' | 'ANUAL';

/**
 * - TESTE: loja nova, 14 dias no Profissional sem cobrança.
 * - ATIVA: cobrança em dia.
 * - PENDENTE: a última cobrança foi recusada; a loja segue funcionando por até 5 dias.
 * - SUSPENSA: teste acabou sem assinatura, ou 5 dias sem pagar. A vitrine sai do ar.
 * - CANCELADA: a loja cancelou; segue no plano até o fim do período pago.
 */
export type StatusAssinatura = 'TESTE' | 'ATIVA' | 'PENDENTE' | 'SUSPENSA' | 'CANCELADA';

export interface Assinatura {
  empreendedorId: string;
  plano: PlanoId;
  periodo: PeriodoAssinatura;
  status: StatusAssinatura;
  /** Assinatura (preapproval) no Mercado Pago. */
  mpPreapprovalId?: string;
  /** E-mail da conta do Mercado Pago que paga a assinatura. */
  emailCobranca?: string;
  fimTeste?: Date;
  /** Fim do período pago: a próxima cobrança, ou até quando a cancelada vale. */
  proximaCobranca?: Date;
  canceladaEm?: Date;
  /** Downgrade marcado: vale a partir da próxima cobrança. */
  planoProximoCiclo?: PlanoId;
  /** Desde quando a cobrança está recusada. */
  pendenteDesde?: Date;
  /** Último aviso do fim do teste já mandado (dia 10 ou 13). */
  avisoTesteDia?: number;
  /** Dia ("2026-10-27") do último aviso de cobrança recusada. */
  avisoCobrancaDia?: string;
  /** Mês ("2026-10") em que os avisos de 80% e 100% dos pedidos já saíram. */
  avisoPedidos80Mes?: string;
  avisoPedidos100Mes?: string;
}

/** O que basta saber da assinatura para decidir o que a loja pode usar. */
export type SituacaoDoPlano = Pick<Assinatura, 'plano' | 'status'>;

/** Prazo da cobrança recusada até a loja ser suspensa. */
export const DIAS_PENDENTE_ATE_SUSPENDER = 5;
/** Dias do teste (contados do início) em que a loja é lembrada de assinar. */
export const DIAS_AVISO_TESTE = [10, 13] as const;

const ORDEM_DOS_PLANOS: Record<PlanoId, number> = { ESSENCIAL: 0, PROFISSIONAL: 1 };

export function iniciarTeste(empreendedorId: string, agora: Date): Assinatura {
  return {
    empreendedorId,
    plano: PLANO_DO_TESTE,
    periodo: 'MENSAL',
    status: 'TESTE',
    fimTeste: new Date(agora.getTime() + DIAS_DE_TESTE * UM_DIA_MS),
  };
}

/** O plano cujos limites e recursos valem agora. Sem assinatura gravada, a loja é tratada como em teste. */
export function planoEfetivo(loja: SituacaoDoPlano | null | undefined): PlanoId {
  if (!loja || loja.status === 'TESTE') {
    return PLANO_DO_TESTE;
  }
  return loja.plano;
}

/** A vitrine e os pedidos só funcionam com a loja fora da suspensão. */
export function lojaDisponivel(loja: SituacaoDoPlano | null | undefined): boolean {
  return loja?.status !== 'SUSPENSA';
}

export function podeUsar(loja: SituacaoDoPlano | null | undefined, recurso: Recurso): boolean {
  return CATALOGO_PLANOS[planoEfetivo(loja)].recursos[recurso];
}

/** null = ilimitado. */
export function limite(loja: SituacaoDoPlano | null | undefined, chave: ChaveLimite): number | null {
  return CATALOGO_PLANOS[planoEfetivo(loja)].limites[chave];
}

/** O plano mais barato que tem o recurso: é o que o bot oferece. */
export function planoQueLibera(recurso: Recurso): PlanoId {
  return (Object.keys(ORDEM_DOS_PLANOS) as PlanoId[])
    .sort((a, b) => ORDEM_DOS_PLANOS[a] - ORDEM_DOS_PLANOS[b])
    .find((plano) => CATALOGO_PLANOS[plano].recursos[recurso]) ?? 'PROFISSIONAL';
}

/** Valor de cada cobrança: o mês, ou o ano inteiro de uma vez. */
export function valorDaCobrancaCentavos(plano: PlanoId, periodo: PeriodoAssinatura): number {
  const { precoMensalCentavos, precoAnualPorMesCentavos } = CATALOGO_PLANOS[plano];
  return periodo === 'ANUAL' ? precoAnualPorMesCentavos * 12 : precoMensalCentavos;
}

/** "R$ 29,99". */
export function formatarCentavos(centavos: number): string {
  return `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;
}

// ---------------------------------------------------------------------------
// Transições
// ---------------------------------------------------------------------------

/** O Mercado Pago confirmou o cartão: a assinatura começa (ou volta) a valer. */
export function assinaturaAutorizada(
  assinatura: Assinatura,
  dados: { plano: PlanoId; periodo: PeriodoAssinatura; mpPreapprovalId: string; proximaCobranca?: Date },
): Assinatura {
  return {
    ...assinatura,
    ...dados,
    status: 'ATIVA',
    canceladaEm: undefined,
    planoProximoCiclo: undefined,
    pendenteDesde: undefined,
    avisoCobrancaDia: undefined,
  };
}

/** Uma cobrança passou: período renovado e, se havia downgrade marcado, ele entra agora. */
export function cobrancaAprovada(assinatura: Assinatura, proximaCobranca?: Date): Assinatura {
  if (assinatura.status === 'CANCELADA') {
    return assinatura;
  }
  return {
    ...assinatura,
    status: 'ATIVA',
    plano: assinatura.planoProximoCiclo ?? assinatura.plano,
    planoProximoCiclo: undefined,
    proximaCobranca: proximaCobranca ?? assinatura.proximaCobranca,
    pendenteDesde: undefined,
    avisoCobrancaDia: undefined,
  };
}

/** Cobrança recusada: a loja fica PENDENTE (e o prazo de 5 dias conta da primeira recusa). */
export function cobrancaRecusada(assinatura: Assinatura, agora: Date): Assinatura {
  if (assinatura.status !== 'ATIVA' && assinatura.status !== 'PENDENTE') {
    return assinatura;
  }
  return { ...assinatura, status: 'PENDENTE', pendenteDesde: assinatura.pendenteDesde ?? agora };
}

export type MudancaDePlano = { quando: 'AGORA' | 'PROXIMO_CICLO'; assinatura: Assinatura };

/** Upgrade vale na hora; downgrade, a partir da próxima cobrança. */
export function mudarPlano(assinatura: Assinatura, novo: PlanoId): MudancaDePlano {
  if (assinatura.status !== 'ATIVA' || !assinatura.mpPreapprovalId) {
    throw new DomainError('Só dá para mudar de plano com a assinatura ativa.', 'ASSINATURA_NAO_ATIVA');
  }
  if (novo === assinatura.plano && !assinatura.planoProximoCiclo) {
    throw new DomainError(`Você já está no plano ${CATALOGO_PLANOS[novo].nome}.`, 'MESMO_PLANO');
  }
  if (novo === assinatura.plano) {
    // Desistiu do downgrade marcado.
    return { quando: 'AGORA', assinatura: { ...assinatura, planoProximoCiclo: undefined } };
  }
  if (ORDEM_DOS_PLANOS[novo] > ORDEM_DOS_PLANOS[assinatura.plano]) {
    return { quando: 'AGORA', assinatura: { ...assinatura, plano: novo, planoProximoCiclo: undefined } };
  }
  return { quando: 'PROXIMO_CICLO', assinatura: { ...assinatura, planoProximoCiclo: novo } };
}

/** Cancelada pela loja: continua valendo até o fim do período pago. */
export function cancelarAssinatura(assinatura: Assinatura, agora: Date): Assinatura {
  if (assinatura.status !== 'ATIVA' && assinatura.status !== 'PENDENTE') {
    throw new DomainError('Não há assinatura ativa para cancelar.', 'ASSINATURA_NAO_ATIVA');
  }
  return { ...assinatura, status: 'CANCELADA', canceladaEm: agora, planoProximoCiclo: undefined };
}

// ---------------------------------------------------------------------------
// Verificação diária
// ---------------------------------------------------------------------------

export type EventoDaVerificacao =
  | { tipo: 'AVISO_FIM_DO_TESTE'; dia: number; diasRestantes: number }
  | { tipo: 'TESTE_ENCERRADO' }
  | { tipo: 'COBRANCA_PENDENTE'; diasParaSuspender: number }
  | { tipo: 'SUSPENSA_POR_FALTA_DE_PAGAMENTO' }
  | { tipo: 'CANCELADA_ENCERRADA' };

/**
 * O que o job diário faz com uma assinatura: avisos do teste (dias 10 e 13),
 * suspensão no fim do teste ou após 5 dias de cobrança recusada, aviso diário
 * da cobrança pendente e fim da cancelada. Cada aviso sai uma vez só, mesmo
 * que o job rode várias vezes no mesmo dia.
 */
export function verificarAssinatura(
  assinatura: Assinatura,
  agora: Date,
  fuso: string,
): { assinatura: Assinatura; eventos: EventoDaVerificacao[] } {
  switch (assinatura.status) {
    case 'TESTE': {
      if (!assinatura.fimTeste) {
        return { assinatura, eventos: [] };
      }
      if (agora >= assinatura.fimTeste) {
        return { assinatura: { ...assinatura, status: 'SUSPENSA' }, eventos: [{ tipo: 'TESTE_ENCERRADO' }] };
      }
      const inicio = assinatura.fimTeste.getTime() - DIAS_DE_TESTE * UM_DIA_MS;
      const dia = Math.floor((agora.getTime() - inicio) / UM_DIA_MS);
      const devido = [...DIAS_AVISO_TESTE].reverse().find((candidato) => dia >= candidato);
      if (devido === undefined || (assinatura.avisoTesteDia ?? 0) >= devido) {
        return { assinatura, eventos: [] };
      }
      const diasRestantes = Math.ceil((assinatura.fimTeste.getTime() - agora.getTime()) / UM_DIA_MS);
      return {
        assinatura: { ...assinatura, avisoTesteDia: devido },
        eventos: [{ tipo: 'AVISO_FIM_DO_TESTE', dia: devido, diasRestantes }],
      };
    }
    case 'PENDENTE': {
      const desde = assinatura.pendenteDesde ?? agora;
      const prazo = desde.getTime() + DIAS_PENDENTE_ATE_SUSPENDER * UM_DIA_MS;
      if (agora.getTime() >= prazo) {
        return {
          assinatura: { ...assinatura, status: 'SUSPENSA' },
          eventos: [{ tipo: 'SUSPENSA_POR_FALTA_DE_PAGAMENTO' }],
        };
      }
      const hoje = diaNoFuso(agora, fuso);
      if (assinatura.avisoCobrancaDia === hoje) {
        return { assinatura, eventos: [] };
      }
      return {
        assinatura: { ...assinatura, pendenteDesde: desde, avisoCobrancaDia: hoje },
        eventos: [{ tipo: 'COBRANCA_PENDENTE', diasParaSuspender: Math.ceil((prazo - agora.getTime()) / UM_DIA_MS) }],
      };
    }
    case 'CANCELADA':
      if (!assinatura.proximaCobranca || agora >= assinatura.proximaCobranca) {
        return { assinatura: { ...assinatura, status: 'SUSPENSA' }, eventos: [{ tipo: 'CANCELADA_ENCERRADA' }] };
      }
      return { assinatura, eventos: [] };
    default:
      return { assinatura, eventos: [] };
  }
}

// ---------------------------------------------------------------------------
// Limite de pedidos
// ---------------------------------------------------------------------------

export type AvisoDePedidos = { faixa: 80 | 100; usados: number; limite: number };

/**
 * Aviso de 80% ou 100% dos pedidos do mês, se ainda não saiu neste mês. O
 * cliente nunca é bloqueado: é só um convite para o upgrade.
 */
export function avisoDeLimiteDePedidos(
  assinatura: Assinatura,
  usados: number,
  mes: string,
): { assinatura: Assinatura; aviso?: AvisoDePedidos } {
  const maximo = limite(assinatura, 'pedidosMes');
  if (maximo === null || maximo <= 0) {
    return { assinatura };
  }
  if (usados >= maximo) {
    if (assinatura.avisoPedidos100Mes === mes) {
      return { assinatura };
    }
    // Quem pula direto para 100% não recebe também o de 80%.
    return {
      assinatura: { ...assinatura, avisoPedidos100Mes: mes, avisoPedidos80Mes: mes },
      aviso: { faixa: 100, usados, limite: maximo },
    };
  }
  if (usados >= Math.ceil(maximo * 0.8) && assinatura.avisoPedidos80Mes !== mes) {
    return { assinatura: { ...assinatura, avisoPedidos80Mes: mes }, aviso: { faixa: 80, usados, limite: maximo } };
  }
  return { assinatura };
}
