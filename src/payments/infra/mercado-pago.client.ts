import type { GatewayPix } from '../application/ports/gateway-pix.js';

interface RespostaPagamentoMp {
  id: number | string;
  status: string;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
    };
  };
}

const BASE_URL = 'https://api.mercadopago.com/v1/payments';

export function criarMercadoPagoClient(accessToken: string, fetchFn: typeof fetch = fetch): GatewayPix {
  return {
    async criarCobrancaPix({ valor, descricao, referenciaExterna }) {
      const resposta = await fetchFn(BASE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': referenciaExterna,
        },
        body: JSON.stringify({
          transaction_amount: valor,
          description: descricao,
          payment_method_id: 'pix',
          external_reference: referenciaExterna,
          payer: { email: `${referenciaExterna}@zapmenu.local` },
        }),
      });

      if (!resposta.ok) {
        throw new Error(`Falha ao criar cobrança PIX no Mercado Pago (HTTP ${resposta.status}).`);
      }

      const dados = (await resposta.json()) as RespostaPagamentoMp;
      return {
        idTransacaoExterno: String(dados.id),
        statusMp: dados.status,
        copiaCola: dados.point_of_interaction?.transaction_data?.qr_code,
        qrCodeBase64: dados.point_of_interaction?.transaction_data?.qr_code_base64,
      };
    },

    async consultarPagamento(idTransacaoExterno) {
      const resposta = await fetchFn(`${BASE_URL}/${idTransacaoExterno}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!resposta.ok) {
        throw new Error(`Falha ao consultar pagamento ${idTransacaoExterno} no Mercado Pago (HTTP ${resposta.status}).`);
      }

      const dados = (await resposta.json()) as RespostaPagamentoMp;
      return { statusMp: dados.status };
    },
  };
}
