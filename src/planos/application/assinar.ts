import { DomainError } from '../../shared/errors/domain-error.js';
import {
  cancelarAssinatura,
  mudarPlano,
  valorDaCobrancaCentavos,
  type Assinatura,
  type MudancaDePlano,
  type PeriodoAssinatura,
} from '../domain/assinatura.js';
import { intervaloDoMes } from '../domain/calendario.js';
import { CATALOGO_PLANOS, PLANOS_IDS, type PlanoId } from '../domain/catalogo.js';
import type { PlanosDeps } from './dependencias.js';
import { mensagemMeuPlano, nomeDoPeriodo } from './mensagens.js';
import type { AssinaturaDaLoja, AssinaturasRepository } from './ports/assinaturas.repository.js';
import type { GatewayAssinaturas } from './ports/gateway-assinaturas.js';

/** Vai na assinatura do Mercado Pago e volta nas notificações: quem assina, qual plano e período. */
export interface ReferenciaDaAssinatura {
  empreendedorId: string;
  plano: PlanoId;
  periodo: PeriodoAssinatura;
}

export function montarReferencia({ empreendedorId, plano, periodo }: ReferenciaDaAssinatura): string {
  return `${empreendedorId}:${plano}:${periodo}`;
}

export function lerReferencia(referencia?: string): ReferenciaDaAssinatura | undefined {
  const [empreendedorId, plano, periodo] = referencia?.split(':') ?? [];
  if (!empreendedorId || !PLANOS_IDS.includes(plano as PlanoId) || (periodo !== 'MENSAL' && periodo !== 'ANUAL')) {
    return undefined;
  }
  return { empreendedorId, plano: plano as PlanoId, periodo };
}

function exigirGateway(deps: Pick<PlanosDeps, 'gateway'>): GatewayAssinaturas {
  if (!deps.gateway) {
    throw new DomainError('A assinatura está indisponível agora. Tente de novo mais tarde.', 'ASSINATURA_INDISPONIVEL', 'INDISPONIVEL');
  }
  return deps.gateway;
}

async function assinaturaDe(
  repo: AssinaturasRepository,
  identificador: string,
  agora: Date,
): Promise<AssinaturaDaLoja & { assinatura: Assinatura }> {
  const encontrada = await repo.obterOuIniciarTeste(identificador, agora);
  if (!encontrada) {
    throw new DomainError('Loja não encontrada.', 'LOJA_NAO_ENCONTRADA', 'NAO_ENCONTRADO');
  }
  return encontrada;
}

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function emailValido(texto: string): boolean {
  return EMAIL_VALIDO.test(texto.trim());
}

export interface PedidoDeAssinatura {
  identificador: string;
  plano: PlanoId;
  periodo: PeriodoAssinatura;
  /** E-mail da conta do Mercado Pago que vai pagar. */
  email: string;
}

/**
 * Cria a assinatura no Mercado Pago e devolve o link para a loja cadastrar o
 * cartão. A assinatura só vale quando o Mercado Pago avisa que autorizou. No
 * teste (ou na cancelada ainda paga), a primeira cobrança fica para o fim do período.
 */
export async function assinar(
  deps: Pick<PlanosDeps, 'repo' | 'gateway'>,
  pedido: PedidoDeAssinatura,
  agora: Date = new Date(),
): Promise<{ linkPagamento: string; primeiraCobranca?: Date }> {
  const gateway = exigirGateway(deps);
  if (!emailValido(pedido.email)) {
    throw new DomainError('Esse e-mail não parece válido.', 'EMAIL_INVALIDO');
  }
  const { assinatura } = await assinaturaDe(deps.repo, pedido.identificador, agora);
  if (assinatura.status === 'ATIVA' && assinatura.periodo === pedido.periodo) {
    throw assinatura.plano === pedido.plano
      ? new DomainError(`Você já assina o plano ${CATALOGO_PLANOS[pedido.plano].nome}.`, 'JA_ASSINA', 'CONFLITO')
      : new DomainError('Sua assinatura já está ativa. Para trocar de plano, mande *mudar de plano*.', 'ASSINATURA_JA_ATIVA', 'CONFLITO');
  }

  const fimPago = assinatura.status === 'TESTE' ? assinatura.fimTeste : assinatura.status === 'CANCELADA' ? assinatura.proximaCobranca : undefined;
  const primeiraCobranca = fimPago && fimPago > agora ? fimPago : undefined;
  const { linkPagamento } = await gateway.criar({
    referencia: montarReferencia({ empreendedorId: assinatura.empreendedorId, plano: pedido.plano, periodo: pedido.periodo }),
    email: pedido.email.trim().toLowerCase(),
    descricao: `ZapMenu ${CATALOGO_PLANOS[pedido.plano].nome} (${nomeDoPeriodo(pedido.periodo)})`,
    valorCentavos: valorDaCobrancaCentavos(pedido.plano, pedido.periodo),
    meses: pedido.periodo === 'ANUAL' ? 12 : 1,
    inicio: primeiraCobranca,
  });
  await deps.repo.salvar({ ...assinatura, emailCobranca: pedido.email.trim().toLowerCase() });
  return { linkPagamento, primeiraCobranca };
}

/** E-mail já usado numa assinatura anterior, para não perguntar de novo. */
export async function emailDaCobranca(repo: AssinaturasRepository, identificador: string): Promise<string | undefined> {
  return (await repo.obter(identificador))?.assinatura?.emailCobranca;
}

/** Upgrade vale na hora; downgrade, na próxima cobrança. O Mercado Pago passa a cobrar o novo valor no próximo ciclo. */
export async function mudarDePlano(
  deps: Pick<PlanosDeps, 'repo' | 'gateway'>,
  identificador: string,
  plano: PlanoId,
  agora: Date = new Date(),
): Promise<MudancaDePlano> {
  const gateway = exigirGateway(deps);
  const { assinatura } = await assinaturaDe(deps.repo, identificador, agora);
  const mudanca = mudarPlano(assinatura, plano);
  const cobrado = mudanca.assinatura.planoProximoCiclo ?? mudanca.assinatura.plano;
  await gateway.alterarValor(assinatura.mpPreapprovalId!, valorDaCobrancaCentavos(cobrado, assinatura.periodo));
  await deps.repo.salvar(mudanca.assinatura);
  return mudanca;
}

/** Para as cobranças; a loja segue no plano até o fim do período pago. */
export async function cancelarAssinaturaDaLoja(
  deps: Pick<PlanosDeps, 'repo' | 'gateway'>,
  identificador: string,
  agora: Date = new Date(),
): Promise<Assinatura> {
  const gateway = exigirGateway(deps);
  const { assinatura } = await assinaturaDe(deps.repo, identificador, agora);
  const cancelada = cancelarAssinatura(assinatura, agora);
  if (assinatura.mpPreapprovalId) {
    await gateway.cancelar(assinatura.mpPreapprovalId);
  }
  await deps.repo.salvar(cancelada);
  return cancelada;
}

/** "meu plano": plano, situação e o uso do mês. */
export async function descreverMeuPlano(
  deps: Pick<PlanosDeps, 'repo'>,
  identificador: string,
  agora: Date = new Date(),
): Promise<string> {
  const { loja, assinatura } = await assinaturaDe(deps.repo, identificador, agora);
  const { inicio, fim } = intervaloDoMes(agora, loja.fuso);
  const [pedidos, produtos] = await Promise.all([
    deps.repo.contarVendas(loja.empreendedorId, inicio, fim),
    deps.repo.contarProdutos(loja.empreendedorId),
  ]);
  return mensagemMeuPlano(assinatura, { pedidos, produtos }, loja.fuso);
}
