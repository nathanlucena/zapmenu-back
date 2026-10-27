import { DomainError } from '../../shared/errors/domain-error.js';
import { logger as loggerRaiz } from '../../shared/logger/logger.js';
import type { Assinatura } from '../../planos/domain/assinatura.js';
import { diaEMes } from '../../planos/domain/calendario.js';
import { CATALOGO_PLANOS, type PlanoId } from '../../planos/domain/catalogo.js';
import type { PlanosDeps } from '../../planos/application/dependencias.js';
import {
  assinar,
  cancelarAssinaturaDaLoja,
  descreverMeuPlano,
  emailValido,
  mudarDePlano,
} from '../../planos/application/assinar.js';
import { comandoAssinar, precoDaAssinatura } from '../../planos/application/mensagens.js';
import type { Contexto } from '../conversation/conversation-state.types.js';
import { reconhecerComando, reconhecerComandoDePlano, type ComandoDePlano } from './comandos.js';

const logger = loggerRaiz.child({ modulo: 'gestao-plano' });

export interface ConversaDoPlano {
  planos: PlanosDeps;
  /** Telefone de quem fala na gestão (identifica a loja). */
  telefone: string;
  texto: string;
  /** Guarda a etapa em andamento (e-mail, confirmação) entre as mensagens. */
  contexto: Contexto;
  assinatura?: Assinatura;
  fuso?: string;
}

const FUSO_PADRAO = 'America/Sao_Paulo';

function nome(plano: PlanoId): string {
  return CATALOGO_PLANOS[plano].nome;
}

const { ESSENCIAL, PROFISSIONAL } = CATALOGO_PLANOS;
const ESCOLHA_DO_PLANO = [
  'Qual plano você quer?',
  `• ${comandoAssinar('ESSENCIAL')}: ${precoDaAssinatura('ESSENCIAL', 'MENSAL')}, até ${ESSENCIAL.limites.pedidosMes} pedidos por mês e ${ESSENCIAL.limites.produtos} produtos`,
  `• ${comandoAssinar('PROFISSIONAL')}: ${precoDaAssinatura('PROFISSIONAL', 'MENSAL')}, ${PROFISSIONAL.limites.pedidosMes?.toLocaleString('pt-BR')} pedidos por mês, produtos ilimitados, entrega por distância, cores e capa, prévia em imagem e sem o selo do ZapMenu`,
  'No anual sai mais barato: acrescente *anual* (ex.: _assinar profissional anual_).',
].join('\n');

const MERCADO_PAGO_FORA = 'Não consegui falar com o Mercado Pago agora 😕 Tente de novo em alguns minutos.';

/** Erro de regra vira a própria mensagem; o resto (Mercado Pago fora do ar) vira um "tente de novo". */
function explicar(erro: unknown): string {
  if (erro instanceof DomainError) {
    return erro.message;
  }
  logger.error({ err: erro }, 'falha na assinatura');
  return MERCADO_PAGO_FORA;
}

async function iniciarAssinatura(
  conversa: ConversaDoPlano,
  plano: PlanoId,
  periodo: 'MENSAL' | 'ANUAL',
  email: string,
): Promise<string[]> {
  try {
    const { linkPagamento, primeiraCobranca } = await assinar(conversa.planos, {
      identificador: conversa.telefone,
      plano,
      periodo,
      email,
    });
    logger.info({ telefone: conversa.telefone, plano, periodo }, '💳 link de assinatura gerado');
    return [
      [
        `Para assinar o *${nome(plano)}* (${precoDaAssinatura(plano, periodo)}), cadastre o cartão neste link do Mercado Pago:`,
        linkPagamento,
        ...(primeiraCobranca ? [`A primeira cobrança só acontece em ${diaEMes(primeiraCobranca, conversa.fuso ?? FUSO_PADRAO)}.`] : []),
        'Assim que o Mercado Pago confirmar, eu aviso aqui. ✅',
      ].join('\n'),
    ];
  } catch (erro) {
    return [explicar(erro)];
  }
}

async function comandoAssinarPlano(conversa: ConversaDoPlano, comando: Extract<ComandoDePlano, { tipo: 'ASSINAR' }>): Promise<string[]> {
  const { assinatura } = conversa;
  // "regularizar" (ou "assinar" de quem já teve assinatura) repete o plano que a loja tinha.
  const plano = comando.plano ?? (assinatura && assinatura.status !== 'TESTE' ? assinatura.plano : undefined);
  if (!plano) {
    return [ESCOLHA_DO_PLANO];
  }
  if (!conversa.planos.gateway) {
    return ['A assinatura está indisponível agora. Tente de novo mais tarde.'];
  }
  const periodo = comando.periodo ?? (assinatura && assinatura.status !== 'TESTE' ? assinatura.periodo : 'MENSAL');
  if (!assinatura?.emailCobranca) {
    conversa.contexto.assinatura = { etapa: 'EMAIL', plano, periodo };
    return [
      `Para assinar o *${nome(plano)}* (${precoDaAssinatura(plano, periodo)}), me mande o *e-mail da sua conta do Mercado Pago*: é nela que a cobrança fica. Para desistir, mande *cancelar*.`,
    ];
  }
  return iniciarAssinatura(conversa, plano, periodo, assinatura.emailCobranca);
}

function comandoMudarPlano(conversa: ConversaDoPlano, comando: Extract<ComandoDePlano, { tipo: 'MUDAR_PLANO' }>): string[] {
  const { assinatura } = conversa;
  if (!assinatura || assinatura.status === 'TESTE') {
    return [`Você está no teste grátis do *Profissional*. ${ESCOLHA_DO_PLANO}`];
  }
  if (assinatura.status !== 'ATIVA') {
    return ['Sua assinatura não está ativa agora. Mande *regularizar* para assinar de novo, ou *meu plano* para ver a situação.'];
  }
  const alvo = comando.plano ?? (assinatura.plano === 'PROFISSIONAL' ? 'ESSENCIAL' : 'PROFISSIONAL');
  if (alvo === assinatura.plano && !assinatura.planoProximoCiclo) {
    return [`Você já está no plano *${nome(alvo)}*.`];
  }
  conversa.contexto.assinatura = { etapa: 'CONFIRMAR_MUDANCA', plano: alvo };
  const fuso = conversa.fuso ?? FUSO_PADRAO;
  const ate = assinatura.proximaCobranca ? diaEMes(assinatura.proximaCobranca, fuso) : 'a próxima cobrança';
  if (alvo === assinatura.plano) {
    return [`Você tinha marcado a troca para o *${nome(assinatura.planoProximoCiclo!)}*. Quer continuar no *${nome(alvo)}*? (*sim*/*não*)`];
  }
  if (alvo === 'PROFISSIONAL') {
    return [
      `O *Profissional* começa a valer agora, e a partir da próxima cobrança o valor passa a ser ${precoDaAssinatura(alvo, assinatura.periodo)}. Confirma? (*sim*/*não*)`,
    ];
  }
  const { limites } = CATALOGO_PLANOS[alvo];
  return [
    `Você continua no *${nome(assinatura.plano)}* até ${ate}. Depois disso fica no *${nome(alvo)}* (${precoDaAssinatura(alvo, assinatura.periodo)}): até ${limites.pedidosMes} pedidos por mês e ${limites.produtos} produtos, sem entrega por distância, cores, capa e prévia em imagem, e com o selo do ZapMenu na vitrine. Confirma? (*sim*/*não*)`,
  ];
}

function comandoCancelar(conversa: ConversaDoPlano): string[] {
  const { assinatura } = conversa;
  if (!assinatura || (assinatura.status !== 'ATIVA' && assinatura.status !== 'PENDENTE')) {
    return ['Você não tem uma assinatura ativa para cancelar. Mande *meu plano* para ver a situação.'];
  }
  conversa.contexto.assinatura = { etapa: 'CONFIRMAR_CANCELAMENTO' };
  const ate = assinatura.proximaCobranca ? ` A loja continua no ar até ${diaEMes(assinatura.proximaCobranca, conversa.fuso ?? FUSO_PADRAO)} e depois sai do ar.` : '';
  return [`Se cancelar, as cobranças param.${ate} Confirma o cancelamento? (*sim*/*não*)`];
}

/** Resposta da etapa em andamento: o e-mail ou o sim/não. */
async function continuar(conversa: ConversaDoPlano, etapa: NonNullable<Contexto['assinatura']>): Promise<string[]> {
  const resposta = reconhecerComando(conversa.texto);
  const encerrar = () => {
    conversa.contexto.assinatura = undefined;
  };

  if (etapa.etapa === 'EMAIL') {
    if (resposta === 'CANCELAR' || resposta === 'NAO') {
      encerrar();
      return ['Ok, não assinei nada. Quando quiser, é só mandar *assinar*.'];
    }
    if (!emailValido(conversa.texto)) {
      return ['Isso não parece um e-mail. Me mande o e-mail da sua conta do Mercado Pago (ou *cancelar*).'];
    }
    encerrar();
    return iniciarAssinatura(conversa, etapa.plano, etapa.periodo, conversa.texto.trim());
  }

  if (resposta !== 'SIM' && resposta !== 'NAO' && resposta !== 'CANCELAR') {
    return ['Responda *sim* para confirmar ou *não* para deixar como está.'];
  }
  encerrar();
  if (resposta !== 'SIM') {
    return ['Ok, nada mudou na sua assinatura.'];
  }
  const fuso = conversa.fuso ?? FUSO_PADRAO;
  try {
    if (etapa.etapa === 'CONFIRMAR_CANCELAMENTO') {
      const cancelada = await cancelarAssinaturaDaLoja(conversa.planos, conversa.telefone);
      const ate = cancelada.proximaCobranca ? ` A loja continua no ar até ${diaEMes(cancelada.proximaCobranca, fuso)}.` : '';
      return [`Assinatura cancelada.${ate} Se mudar de ideia, mande ${comandoAssinar(cancelada.plano)}.`];
    }
    const { quando, assinatura } = await mudarDePlano(conversa.planos, conversa.telefone, etapa.plano);
    if (!assinatura.planoProximoCiclo && quando === 'AGORA') {
      return [`✅ Pronto! Sua loja está no plano *${nome(assinatura.plano)}*.`];
    }
    const data = assinatura.proximaCobranca ? diaEMes(assinatura.proximaCobranca, fuso) : 'a próxima cobrança';
    return [`✅ Combinado: a partir de ${data} sua loja fica no plano *${nome(assinatura.planoProximoCiclo ?? assinatura.plano)}*.`];
  } catch (erro) {
    return [explicar(erro)];
  }
}

/**
 * Comandos da assinatura na gestão ("meu plano", "assinar", "mudar de plano",
 * "cancelar assinatura", "regularizar") e as etapas que eles abrem. Tudo sem IA.
 * Devolve undefined quando a mensagem não é sobre o plano.
 */
export async function conversaDoPlano(conversa: ConversaDoPlano): Promise<string[] | undefined> {
  const comando = reconhecerComandoDePlano(conversa.texto);
  const pendente = conversa.contexto.assinatura;
  if (pendente && !comando) {
    return continuar(conversa, pendente);
  }
  // Um comando novo substitui a etapa que estava aberta.
  conversa.contexto.assinatura = undefined;
  switch (comando?.tipo) {
    case 'MEU_PLANO':
      return [await descreverMeuPlano(conversa.planos, conversa.telefone)];
    case 'ASSINAR':
      return comandoAssinarPlano(conversa, comando);
    case 'MUDAR_PLANO':
      return comandoMudarPlano(conversa, comando);
    case 'CANCELAR_ASSINATURA':
      return comandoCancelar(conversa);
    default:
      return undefined;
  }
}
