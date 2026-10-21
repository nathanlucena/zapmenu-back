import type { Pedido } from '../../orders/domain/pedido.js';
import { logger } from '../../shared/logger/logger.js';
import { aplicarStatusPagamento } from '../application/aplicar-status-pagamento.js';
import type { PaymentsServiceDeps } from '../application/dependencias.js';
import type { GeradorCobranca } from '../application/gerar-cobranca.js';

type DepsSimulacao = Pick<PaymentsServiceDeps, 'paymentsRepo' | 'ordersRepo' | 'notificarEmpreendedor'>;

export interface OpcoesPagamentoSimulado {
  modoAutoteste: boolean;
  segundos: number;
}

async function aprovarSeAindaPendente(deps: DepsSimulacao, pedido: Pedido): Promise<void> {
  const pagamento = await deps.paymentsRepo.buscarPorPedidoId(pedido.id);
  const atual = await deps.ordersRepo.buscarPorId(pedido.id);
  // Já pago (webhook, polling ou outra simulação), expirado ou cancelado: nada a fazer.
  if (pagamento?.status !== 'PENDENTE' || atual?.status !== 'AGUARDANDO_PAGAMENTO') {
    return;
  }

  logger.warn({ codigoCurto: pedido.codigoCurto }, `MODO AUTOTESTE: pagamento simulado do pedido ${pedido.codigoCurto}`);
  await aplicarStatusPagamento(deps, pagamento, 'APROVADO', new Date());
}

/**
 * No modo autoteste, simula o cliente pagando o PIX: N segundos depois de gerar
 * a cobrança, aprova pelo mesmo caminho do webhook e do polling. Fora do
 * autoteste (ou com N = 0) devolve o gerador sem mudança.
 */
export function comPagamentoSimulado(
  gerador: GeradorCobranca,
  deps: DepsSimulacao,
  { modoAutoteste, segundos }: OpcoesPagamentoSimulado,
): GeradorCobranca {
  if (!modoAutoteste || segundos <= 0) {
    return gerador;
  }

  return {
    async gerarCobranca(pedido) {
      const cobranca = await gerador.gerarCobranca(pedido);
      setTimeout(() => {
        aprovarSeAindaPendente(deps, pedido).catch((erro: unknown) => {
          logger.error({ err: erro, codigoCurto: pedido.codigoCurto }, 'falha ao simular pagamento no modo autoteste');
        });
      }, segundos * 1000);
      return cobranca;
    },
  };
}
