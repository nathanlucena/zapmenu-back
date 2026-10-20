import type { Pedido } from '../../orders/domain/pedido.js';
import { mapearStatusMercadoPago } from '../domain/pagamento.js';
import type { PaymentsServiceDeps } from './dependencias.js';

export interface CobrancaGerada {
  copiaCola: string;
  qrCodeBase64?: string;
}

export interface GeradorCobranca {
  gerarCobranca(pedido: Pedido): Promise<CobrancaGerada>;
}

/** Gera o PIX do pedido uma vez só; pedidos repetidos recebem a mesma cobrança. */
export function criarGeradorCobranca(
  deps: Pick<PaymentsServiceDeps, 'gatewayPix' | 'paymentsRepo'>,
  relogio: () => Date = () => new Date(),
): GeradorCobranca {
  return {
    async gerarCobranca(pedido: Pedido): Promise<CobrancaGerada> {
      const existente = await deps.paymentsRepo.buscarPorPedidoId(pedido.id);
      if (existente) {
        return { copiaCola: existente.copiaCola ?? '', qrCodeBase64: existente.qrCodeBase64 };
      }

      const cobranca = await deps.gatewayPix.criarCobrancaPix({
        valor: pedido.valorTotal,
        descricao: `Pedido ${pedido.codigoCurto}`,
        referenciaExterna: pedido.id,
      });

      await deps.paymentsRepo.criar({
        pedidoId: pedido.id,
        provedor: 'mercado_pago',
        idTransacaoExterno: cobranca.idTransacaoExterno,
        status: mapearStatusMercadoPago(cobranca.statusMp),
        copiaCola: cobranca.copiaCola,
        qrCodeBase64: cobranca.qrCodeBase64,
        criadoEm: relogio(),
      });

      return { copiaCola: cobranca.copiaCola ?? '', qrCodeBase64: cobranca.qrCodeBase64 };
    },
  };
}
