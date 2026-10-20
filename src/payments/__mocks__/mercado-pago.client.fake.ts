import type { CobrancaPixCriada, GatewayPix } from '../application/ports/gateway-pix.js';

export interface MercadoPagoClientFake extends GatewayPix {
  definirStatusConsulta(idTransacaoExterno: string, statusMp: string): void;
}

let proximoId = 1;

export function criarMercadoPagoClientFake(): MercadoPagoClientFake {
  const statusPorTransacao = new Map<string, string>();

  return {
    async criarCobrancaPix({ referenciaExterna }) {
      const idTransacaoExterno = `mp-${proximoId++}`;
      statusPorTransacao.set(idTransacaoExterno, 'pending');
      const cobranca: CobrancaPixCriada = {
        idTransacaoExterno,
        statusMp: 'pending',
        copiaCola: `00020126-pix-${referenciaExterna}`,
        qrCodeBase64: 'data:image/png;base64,FAKE',
      };
      return cobranca;
    },

    async consultarPagamento(idTransacaoExterno) {
      return { statusMp: statusPorTransacao.get(idTransacaoExterno) ?? 'pending' };
    },

    definirStatusConsulta(idTransacaoExterno, statusMp) {
      statusPorTransacao.set(idTransacaoExterno, statusMp);
    },
  };
}
