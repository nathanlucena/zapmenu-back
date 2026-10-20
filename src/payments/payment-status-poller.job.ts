import { logger } from '../shared/logger/logger.js';
import { pollarPagamentosPendentes, type PaymentsServiceDeps } from './payments.service.js';

export async function executarCicloPolling(
  deps: Pick<PaymentsServiceDeps, 'mpClient' | 'paymentsRepo' | 'ordersRepo' | 'notificarEmpreendedor'>,
  idadeMinimaSegundos: number,
): Promise<void> {
  const limiteIdade = new Date(Date.now() - idadeMinimaSegundos * 1000);
  await pollarPagamentosPendentes(deps, limiteIdade);
}

export function iniciarJobPollingPagamentos(
  deps: Pick<PaymentsServiceDeps, 'mpClient' | 'paymentsRepo' | 'ordersRepo' | 'notificarEmpreendedor'>,
  intervaloMs: number,
  idadeMinimaSegundos: number,
): NodeJS.Timeout {
  return setInterval(() => {
    executarCicloPolling(deps, idadeMinimaSegundos).catch((erro: unknown) => {
      logger.error({ err: erro }, 'falha no polling de status de pagamento');
    });
  }, intervaloMs);
}
