import { logger } from '../../shared/logger/logger.js';
import { pollarPagamentosPendentes } from '../application/pollar-pagamentos-pendentes.js';
import { type PaymentsServiceDeps } from '../application/dependencias.js';

export async function executarCicloPolling(
  deps: Pick<PaymentsServiceDeps, 'gatewayPix' | 'paymentsRepo' | 'ordersRepo' | 'notificarEmpreendedor'>,
  idadeMinimaSegundos: number,
): Promise<void> {
  const limiteIdade = new Date(Date.now() - idadeMinimaSegundos * 1000);
  await pollarPagamentosPendentes(deps, limiteIdade);
}

export function iniciarJobPollingPagamentos(
  deps: Pick<PaymentsServiceDeps, 'gatewayPix' | 'paymentsRepo' | 'ordersRepo' | 'notificarEmpreendedor'>,
  intervaloMs: number,
  idadeMinimaSegundos: number,
): NodeJS.Timeout {
  return setInterval(() => {
    executarCicloPolling(deps, idadeMinimaSegundos).catch((erro: unknown) => {
      logger.error({ err: erro }, 'falha no polling de status de pagamento');
    });
  }, intervaloMs);
}
