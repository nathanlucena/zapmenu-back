import { chamarServico, falhaHttp } from '../../shared/errors/integracao-error.js';
import type { GatewayPix } from '../application/ports/gateway-pix.js';

/** Resposta da API de Orders (POST e GET /v1/orders), só com o que usamos. */
interface RespostaOrderMp {
  id: string;
  status: string;
  status_detail?: string;
  transactions?: {
    payments?: {
      payment_method?: {
        qr_code?: string;
        qr_code_base64?: string;
      };
    }[];
  };
}

const BASE_URL = 'https://api.mercadopago.com/v1/orders';

/** Prazo para o cliente pagar o PIX. O Mercado Pago aceita de 30 minutos a 30 dias. */
const PRAZO_PIX = 'PT30M';

/** Quanto esperar o Mercado Pago responder antes de desistir. */
const TIMEOUT_MS = 15_000;

/**
 * A order vencida vem como "canceled" ou "failed" com detalhe "expired";
 * devolvemos "expired" para o domínio separar vencido de recusado.
 */
function statusDa(order: RespostaOrderMp): string {
  return order.status_detail === 'expired' ? 'expired' : order.status;
}

/** Cobrança PIX pela API de Orders do Mercado Pago (Checkout API). */
export interface OpcoesMercadoPago {
  /** Só com credenciais de teste: enviado como `payer.first_name` ("APRO" aprova o PIX de teste). */
  pagadorTeste?: string;
}

export function criarMercadoPagoClient(
  accessToken: string,
  fetchFn: typeof fetch = fetch,
  opcoes: OpcoesMercadoPago = {},
): GatewayPix {
  return {
    async criarCobrancaPix({ valor, descricao, referenciaExterna }) {
      // A API de Orders recebe valores como texto com duas casas ("25.00").
      const total = valor.toFixed(2);
      const resposta = await chamarServico('mercado_pago', 'Falha ao criar cobrança PIX no Mercado Pago', () =>
        fetchFn(BASE_URL, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': referenciaExterna,
          },
          body: JSON.stringify({
            type: 'online',
            processing_mode: 'automatic',
            total_amount: total,
            external_reference: referenciaExterna,
            description: descricao,
            payer: {
              email: `${referenciaExterna}@zapmenu.local`,
              ...(opcoes.pagadorTeste && { first_name: opcoes.pagadorTeste }),
            },
            transactions: {
              payments: [
                {
                  amount: total,
                  payment_method: { id: 'pix', type: 'bank_transfer' },
                  expiration_time: PRAZO_PIX,
                },
              ],
            },
          }),
        }),
      );

      if (!resposta.ok) {
        throw falhaHttp('mercado_pago', resposta.status, 'Falha ao criar cobrança PIX no Mercado Pago');
      }

      const order = (await resposta.json()) as RespostaOrderMp;
      const metodo = order.transactions?.payments?.[0]?.payment_method;
      return {
        idTransacaoExterno: order.id,
        statusMp: statusDa(order),
        copiaCola: metodo?.qr_code,
        qrCodeBase64: metodo?.qr_code_base64,
      };
    },

    async consultarPagamento(idTransacaoExterno) {
      const descricao = `Falha ao consultar a order ${idTransacaoExterno} no Mercado Pago`;
      const resposta = await chamarServico('mercado_pago', descricao, () =>
        fetchFn(`${BASE_URL}/${encodeURIComponent(idTransacaoExterno)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
      );

      if (!resposta.ok) {
        throw falhaHttp('mercado_pago', resposta.status, descricao);
      }

      return { statusMp: statusDa((await resposta.json()) as RespostaOrderMp) };
    },
  };
}
