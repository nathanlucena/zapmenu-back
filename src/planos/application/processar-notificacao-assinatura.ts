import { DomainError } from '../../shared/errors/domain-error.js';
import { logger } from '../../shared/logger/logger.js';
import {
  assinaturaAutorizada,
  cancelarAssinatura,
  cobrancaAprovada,
  cobrancaRecusada,
} from '../domain/assinatura.js';
import { diaNoFuso } from '../domain/calendario.js';
import { lerReferencia } from './assinar.js';
import type { PlanosDeps } from './dependencias.js';
import {
  mensagemAssinaturaConfirmada,
  mensagemCanceladaNoMercadoPago,
  mensagemCobrancaPendente,
  mensagemPagamentoRegularizado,
} from './mensagens.js';
import { DIAS_PENDENTE_ATE_SUSPENDER } from '../domain/assinatura.js';

const ORIGEM_IDEMPOTENCIA = 'mercado_pago_assinaturas_webhook';

export interface NotificacaoAssinatura {
  eventoId: string;
  /** "subscription_preapproval" ou "subscription_authorized_payment". */
  tipo: string;
  /** Id da assinatura ou da cobrança, conforme o tipo. */
  recursoId: string;
}

type Deps = Required<Pick<PlanosDeps, 'repo' | 'mensageiro' | 'gateway'>> & Pick<PlanosDeps, 'idempotency'>;

function naoEncontrada(id: string): DomainError {
  return new DomainError(`Assinatura ${id} não é do ZapMenu.`, 'ASSINATURA_NAO_ENCONTRADA', 'NAO_ENCONTRADO');
}

/** Aviso à loja não desfaz o que já foi gravado. */
async function avisar(deps: Deps, telefone: string, texto: string): Promise<void> {
  try {
    await deps.mensageiro.enviarTexto(telefone, texto);
  } catch (erro) {
    logger.warn({ err: erro }, 'não foi possível avisar a loja sobre a assinatura');
  }
}

/** A assinatura mudou no Mercado Pago: cartão autorizado (começa a valer) ou cancelada por lá. */
async function tratarAssinatura(deps: Deps, id: string, agora: Date): Promise<void> {
  const noGateway = await deps.gateway.consultar(id);
  const referencia = lerReferencia(noGateway.referencia);
  const encontrada =
    (await deps.repo.porPreapproval(id)) ??
    (referencia ? await deps.repo.obterOuIniciarTeste(referencia.empreendedorId, agora) : null);
  if (!encontrada) {
    throw naoEncontrada(id);
  }
  const { loja, assinatura } = encontrada;
  const atual = assinatura.mpPreapprovalId === id;

  if (noGateway.situacao === 'AUTORIZADA') {
    if (atual && (assinatura.status === 'ATIVA' || assinatura.status === 'PENDENTE')) {
      // Já valendo: só acompanha a data da próxima cobrança.
      if (noGateway.proximaCobranca && noGateway.proximaCobranca.getTime() !== assinatura.proximaCobranca?.getTime()) {
        await deps.repo.salvar({ ...assinatura, proximaCobranca: noGateway.proximaCobranca });
      }
      return;
    }
    if (!referencia) {
      throw naoEncontrada(id);
    }
    const autorizada = assinaturaAutorizada(assinatura, {
      plano: referencia.plano,
      periodo: referencia.periodo,
      mpPreapprovalId: id,
      proximaCobranca: noGateway.proximaCobranca,
    });
    await deps.repo.salvar(autorizada);
    logger.info({ empreendedorId: loja.empreendedorId, plano: autorizada.plano }, '💳 assinatura autorizada');
    // Assinou de novo (regularizar, trocar de período): a assinatura antiga para de cobrar.
    if (assinatura.mpPreapprovalId && !atual) {
      await deps.gateway.cancelar(assinatura.mpPreapprovalId).catch((erro: unknown) => {
        logger.error({ err: erro, mpPreapprovalId: assinatura.mpPreapprovalId }, 'falha ao cancelar a assinatura antiga');
      });
    }
    await avisar(deps, loja.telefone, mensagemAssinaturaConfirmada(autorizada, loja.fuso));
    return;
  }

  if (noGateway.situacao === 'CANCELADA' && atual && (assinatura.status === 'ATIVA' || assinatura.status === 'PENDENTE')) {
    const cancelada = cancelarAssinatura(assinatura, agora);
    await deps.repo.salvar(cancelada);
    await avisar(deps, loja.telefone, mensagemCanceladaNoMercadoPago(cancelada, loja.fuso));
  }
}

/** Uma cobrança da assinatura passou ou foi recusada. */
async function tratarCobranca(deps: Deps, id: string, agora: Date): Promise<void> {
  const cobranca = await deps.gateway.consultarCobranca(id);
  const encontrada = await deps.repo.porPreapproval(cobranca.assinaturaId);
  if (!encontrada) {
    throw naoEncontrada(cobranca.assinaturaId);
  }
  const { loja, assinatura } = encontrada;

  if (cobranca.situacao === 'APROVADA') {
    const { proximaCobranca } = await deps.gateway.consultar(cobranca.assinaturaId);
    const paga = cobrancaAprovada(assinatura, proximaCobranca);
    await deps.repo.salvar(paga);
    if (assinatura.status === 'PENDENTE' || assinatura.status === 'SUSPENSA') {
      await avisar(deps, loja.telefone, mensagemPagamentoRegularizado());
    }
    return;
  }
  if (cobranca.situacao === 'RECUSADA') {
    const recusada = cobrancaRecusada(assinatura, agora);
    if (recusada.status !== 'PENDENTE' || assinatura.status === 'PENDENTE') {
      return;
    }
    // Primeira recusa: avisa já e conta como o aviso de hoje do job.
    await deps.repo.salvar({ ...recusada, avisoCobrancaDia: diaNoFuso(agora, loja.fuso) });
    logger.info({ empreendedorId: loja.empreendedorId }, '💳 cobrança da assinatura recusada');
    await avisar(deps, loja.telefone, mensagemCobrancaPendente(DIAS_PENDENTE_ATE_SUSPENDER));
  }
}

/**
 * Notificação do Mercado Pago sobre a assinatura. Como no PIX, a situação
 * nunca vem do corpo da notificação: é sempre consultada na API.
 */
export async function processarNotificacaoAssinatura(
  deps: Deps,
  notificacao: NotificacaoAssinatura,
  agora: Date = new Date(),
): Promise<void> {
  if (await deps.idempotency?.jaProcessado(ORIGEM_IDEMPOTENCIA, notificacao.eventoId)) {
    return;
  }
  if (notificacao.tipo.includes('authorized_payment')) {
    await tratarCobranca(deps, notificacao.recursoId, agora);
  } else if (notificacao.tipo.includes('preapproval')) {
    await tratarAssinatura(deps, notificacao.recursoId, agora);
  } else {
    logger.info({ tipo: notificacao.tipo }, 'notificação de assinatura de outro tipo, ignorada');
  }
  await deps.idempotency?.marcarProcessado(ORIGEM_IDEMPOTENCIA, notificacao.eventoId);
}
