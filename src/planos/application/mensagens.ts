import {
  formatarCentavos,
  planoEfetivo,
  planoQueLibera,
  valorDaCobrancaCentavos,
  type Assinatura,
  type AvisoDePedidos,
  type PeriodoAssinatura,
} from '../domain/assinatura.js';
import { diaEMes } from '../domain/calendario.js';
import { CATALOGO_PLANOS, type PlanoId, type Recurso } from '../domain/catalogo.js';

/** Textos que a loja recebe na gestão sobre o plano. Ficam juntos para o tom ser um só. */

function nome(plano: PlanoId): string {
  return CATALOGO_PLANOS[plano].nome;
}

/** "*assinar profissional*", o comando que a loja manda. */
export function comandoAssinar(plano: PlanoId): string {
  return `*assinar ${nome(plano).toLowerCase()}*`;
}

function linhaDoLink(linkDosPlanos?: string): string[] {
  return linkDosPlanos ? [`Veja os planos: ${linkDosPlanos}`] : [];
}

function precosDosPlanos(): string {
  return (Object.keys(CATALOGO_PLANOS) as PlanoId[])
    .map((plano) => `${comandoAssinar(plano)} (${formatarCentavos(valorDaCobrancaCentavos(plano, 'MENSAL'))}/mês)`)
    .join(' ou ');
}

/** Recurso fora do plano: explica e convida para o upgrade. */
export function mensagemRecursoDoPlano(recurso: Recurso, linkDosPlanos?: string): string {
  const plano = planoQueLibera(recurso);
  return [
    `🔒 Isso faz parte do plano *${nome(plano)}*.`,
    ...linhaDoLink(linkDosPlanos),
    `Para assinar, mande ${comandoAssinar(plano)}.`,
  ].join('\n');
}

/** Cadastro de produto acima do limite do plano. */
export function mensagemLimiteDeProdutos(maximo: number, plano: PlanoId, linkDosPlanos?: string): string {
  return [
    `🔒 O plano *${nome(plano)}* permite até ${maximo} produtos, e a sua loja já chegou nesse número. Não anotei os produtos novos.`,
    'No plano *Profissional* os produtos são ilimitados.',
    ...linhaDoLink(linkDosPlanos),
    `Para assinar, mande ${comandoAssinar('PROFISSIONAL')}.`,
  ].join('\n');
}

export function mensagemLimiteDePedidos(aviso: AvisoDePedidos, plano: PlanoId, linkDosPlanos?: string): string {
  const cabecalho =
    aviso.faixa === 100
      ? `📈 Sua loja chegou a ${aviso.usados} pedidos este mês, o limite do plano *${nome(plano)}* (${aviso.limite}). Os pedidos continuam chegando normalmente.`
      : `📈 Sua loja já recebeu ${aviso.usados} dos ${aviso.limite} pedidos do mês no plano *${nome(plano)}*.`;
  const convite =
    plano === 'PROFISSIONAL'
      ? 'Se o movimento continuar assim, fale com a gente para um plano maior.'
      : `No *Profissional* são ${CATALOGO_PLANOS.PROFISSIONAL.limites.pedidosMes?.toLocaleString('pt-BR')} pedidos por mês. Para mudar, mande *mudar de plano*.`;
  return [cabecalho, convite, ...(plano === 'PROFISSIONAL' ? [] : linhaDoLink(linkDosPlanos))].join('\n');
}

export function mensagemFimDoTeste(diasRestantes: number, linkDosPlanos?: string): string {
  const quando = diasRestantes <= 1 ? 'acaba amanhã' : `acaba em ${diasRestantes} dias`;
  return [
    `⏳ Seu teste grátis do plano *Profissional* ${quando}.`,
    `Para sua loja continuar no ar, mande ${precosDosPlanos()}. No anual sai mais barato: acrescente *anual* (ex.: _assinar profissional anual_).`,
    ...linhaDoLink(linkDosPlanos),
  ].join('\n');
}

export function mensagemTesteEncerrado(linkDosPlanos?: string): string {
  return [
    '😕 Seu teste grátis acabou e a loja saiu do ar por enquanto. Os produtos e pedidos continuam guardados.',
    `Para voltar, mande ${precosDosPlanos()}.`,
    ...linhaDoLink(linkDosPlanos),
  ].join('\n');
}

export function mensagemCobrancaPendente(diasParaSuspender: number): string {
  const prazo = diasParaSuspender <= 1 ? 'amanhã' : `em ${diasParaSuspender} dias`;
  return [
    '⚠️ Não conseguimos cobrar a assinatura do ZapMenu no seu cartão.',
    `Atualize o cartão no Mercado Pago ou mande *regularizar* para gerar um link novo. Se não der certo, a loja sai do ar ${prazo}.`,
  ].join('\n');
}

export function mensagemSuspensaPorFaltaDePagamento(): string {
  return '😕 A assinatura ficou 5 dias sem pagamento e a loja saiu do ar por enquanto. Mande *regularizar* para voltar; nada foi apagado.';
}

export function mensagemCanceladaEncerrada(): string {
  return `Sua assinatura cancelada terminou e a loja saiu do ar. Quando quiser voltar, mande ${precosDosPlanos()}.`;
}

export function mensagemLojaSuspensa(): string {
  return `⛔ Sua loja está fora do ar por falta de assinatura. Para voltar, mande *regularizar* (ou ${precosDosPlanos()}). Também respondo *meu plano*.`;
}

export function nomeDoPeriodo(periodo: PeriodoAssinatura): string {
  return periodo === 'ANUAL' ? 'anual' : 'mensal';
}

/** "R$ 59,99/mês" ou "R$ 599,88/ano". */
export function precoDaAssinatura(plano: PlanoId, periodo: PeriodoAssinatura): string {
  return `${formatarCentavos(valorDaCobrancaCentavos(plano, periodo))}/${periodo === 'ANUAL' ? 'ano' : 'mês'}`;
}

export function mensagemAssinaturaConfirmada(assinatura: Assinatura, fuso: string): string {
  const quando = assinatura.proximaCobranca ? ` A próxima cobrança é em ${diaEMes(assinatura.proximaCobranca, fuso)}.` : '';
  return `✅ Assinatura confirmada! Sua loja está no plano *${nome(assinatura.plano)}* (${precoDaAssinatura(assinatura.plano, assinatura.periodo)}).${quando}`;
}

export function mensagemPagamentoRegularizado(): string {
  return '✅ Pagamento da assinatura confirmado. Sua loja está no ar normalmente.';
}

export function mensagemCanceladaNoMercadoPago(assinatura: Assinatura, fuso: string): string {
  const ate = assinatura.proximaCobranca ? ` A loja continua no plano até ${diaEMes(assinatura.proximaCobranca, fuso)}.` : '';
  return `A assinatura foi cancelada no Mercado Pago.${ate} Para assinar de novo, mande ${comandoAssinar(assinatura.plano)}.`;
}

export interface UsoDoMes {
  pedidos: number;
  produtos: number;
}

function linhaDeUso(rotulo: string, usado: number, maximo: number | null): string {
  return maximo === null ? `${rotulo}: ${usado} (ilimitado)` : `${rotulo}: ${usado} de ${maximo.toLocaleString('pt-BR')}`;
}

/** Resposta ao "meu plano". */
export function mensagemMeuPlano(assinatura: Assinatura, uso: UsoDoMes, fuso: string): string {
  const efetivo = planoEfetivo(assinatura);
  const data = (quando?: Date) => (quando ? diaEMes(quando, fuso) : '—');
  const situacao: Record<Assinatura['status'], string> = {
    TESTE: `teste grátis até ${data(assinatura.fimTeste)}`,
    ATIVA: `${precoDaAssinatura(assinatura.plano, assinatura.periodo)}, próxima cobrança em ${data(assinatura.proximaCobranca)}`,
    PENDENTE: '⚠️ a última cobrança foi recusada: atualize o cartão no Mercado Pago ou mande *regularizar*',
    SUSPENSA: '⛔ loja fora do ar: mande *regularizar* para voltar',
    CANCELADA: `cancelado, vale até ${data(assinatura.proximaCobranca)}`,
  };
  const { limites } = CATALOGO_PLANOS[efetivo];
  return [
    `📋 *Seu plano: ${nome(efetivo)}* (${situacao[assinatura.status]})`,
    ...(assinatura.planoProximoCiclo
      ? [`A partir de ${data(assinatura.proximaCobranca)}: *${nome(assinatura.planoProximoCiclo)}*.`]
      : []),
    '',
    linhaDeUso('Pedidos este mês', uso.pedidos, limites.pedidosMes),
    linhaDeUso('Produtos', uso.produtos, limites.produtos),
    '',
    assinatura.status === 'ATIVA'
      ? 'Para trocar, mande *mudar de plano*; para cancelar, *cancelar assinatura*.'
      : `Para assinar, mande ${precosDosPlanos()}. No anual sai mais barato: acrescente *anual*.`,
  ].join('\n');
}
