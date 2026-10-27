import { chamarServico, falhaHttp } from '../../shared/errors/integracao-error.js';
import type {
  CobrancaNoGateway,
  GatewayAssinaturas,
  SituacaoNoGateway,
} from '../application/ports/gateway-assinaturas.js';

const BASE_URL = 'https://api.mercadopago.com';
/** Quanto esperar o Mercado Pago responder antes de desistir. */
const TIMEOUT_MS = 15_000;

/** Resposta de /preapproval, só com o que usamos. */
interface PreapprovalMp {
  id: string;
  status: string;
  external_reference?: string;
  init_point?: string;
  sandbox_init_point?: string;
  next_payment_date?: string;
}

/** Resposta de /authorized_payments (cada cobrança da assinatura). */
interface CobrancaMp {
  id: string | number;
  preapproval_id: string;
  status: string;
  payment?: { status?: string };
}

const SITUACOES: Record<string, SituacaoNoGateway> = {
  pending: 'PENDENTE',
  authorized: 'AUTORIZADA',
  paused: 'PAUSADA',
  cancelled: 'CANCELADA',
};

/** approved = paga; rejected/cancelled ou em nova tentativa (recycling) = recusada; o resto ainda vai acontecer. */
function situacaoDaCobranca(cobranca: CobrancaMp): CobrancaNoGateway['situacao'] {
  const pagamento = cobranca.payment?.status;
  if (pagamento === 'approved') return 'APROVADA';
  if (pagamento === 'rejected' || pagamento === 'cancelled' || cobranca.status === 'recycling' || cobranca.status === 'cancelled') {
    return 'RECUSADA';
  }
  return 'EM_ANDAMENTO';
}

function data(texto?: string): Date | undefined {
  return texto ? new Date(texto) : undefined;
}

export interface OpcoesMercadoPagoAssinaturas {
  /** Para onde o Mercado Pago manda a pessoa depois de cadastrar o cartão. */
  urlDeRetorno: string;
  /** Credenciais de teste: usa o link do sandbox quando o Mercado Pago devolve um. */
  sandbox: boolean;
}

/**
 * Mercado Pago Assinaturas (preapproval) na conta do próprio ZapMenu, com
 * credenciais separadas das lojas. A assinatura é criada pendente e a loja
 * cadastra o cartão no link devolvido.
 */
export function criarMercadoPagoAssinaturasClient(
  accessToken: string,
  opcoes: OpcoesMercadoPagoAssinaturas,
  fetchFn: typeof fetch = fetch,
): GatewayAssinaturas {
  async function chamar<T>(caminho: string, descricao: string, init: RequestInit = {}): Promise<T> {
    const resposta = await chamarServico('mercado_pago', descricao, () =>
      fetchFn(`${BASE_URL}${caminho}`, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...init.headers },
      }),
    );
    if (!resposta.ok) {
      throw falhaHttp('mercado_pago', resposta.status, descricao);
    }
    return (await resposta.json()) as T;
  }

  return {
    async criar(dados) {
      const preapproval = await chamar<PreapprovalMp>('/preapproval', 'Falha ao criar a assinatura no Mercado Pago', {
        method: 'POST',
        headers: { 'X-Idempotency-Key': `${dados.referencia}:${dados.email}:${dados.valorCentavos}` },
        body: JSON.stringify({
          reason: dados.descricao,
          external_reference: dados.referencia,
          payer_email: dados.email,
          back_url: opcoes.urlDeRetorno,
          status: 'pending',
          auto_recurring: {
            frequency: dados.meses,
            frequency_type: 'months',
            transaction_amount: dados.valorCentavos / 100,
            currency_id: 'BRL',
            ...(dados.inicio && { start_date: dados.inicio.toISOString() }),
          },
        }),
      });
      const link = (opcoes.sandbox && preapproval.sandbox_init_point) || preapproval.init_point;
      if (!link) {
        throw new Error(`O Mercado Pago não devolveu o link da assinatura ${preapproval.id}.`);
      }
      return { id: preapproval.id, linkPagamento: link };
    },

    async consultar(id) {
      const preapproval = await chamar<PreapprovalMp>(
        `/preapproval/${encodeURIComponent(id)}`,
        `Falha ao consultar a assinatura ${id} no Mercado Pago`,
      );
      return {
        id: preapproval.id,
        situacao: SITUACOES[preapproval.status] ?? 'PENDENTE',
        referencia: preapproval.external_reference,
        proximaCobranca: data(preapproval.next_payment_date),
      };
    },

    async consultarCobranca(id) {
      const cobranca = await chamar<CobrancaMp>(
        `/authorized_payments/${encodeURIComponent(id)}`,
        `Falha ao consultar a cobrança ${id} da assinatura no Mercado Pago`,
      );
      return { id: String(cobranca.id), assinaturaId: cobranca.preapproval_id, situacao: situacaoDaCobranca(cobranca) };
    },

    async alterarValor(id, valorCentavos) {
      await chamar(`/preapproval/${encodeURIComponent(id)}`, `Falha ao mudar o valor da assinatura ${id}`, {
        method: 'PUT',
        body: JSON.stringify({ auto_recurring: { transaction_amount: valorCentavos / 100, currency_id: 'BRL' } }),
      });
    },

    async cancelar(id) {
      await chamar(`/preapproval/${encodeURIComponent(id)}`, `Falha ao cancelar a assinatura ${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'cancelled' }),
      });
    },
  };
}
