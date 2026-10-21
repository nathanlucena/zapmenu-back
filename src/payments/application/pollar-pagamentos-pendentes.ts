import { mapearStatusMercadoPago } from '../domain/pagamento.js';
import { aplicarStatusPagamento } from './aplicar-status-pagamento.js';
import type { PaymentsServiceDeps } from './dependencias.js';

export async function pollarPagamentosPendentes(
  deps: Pick<PaymentsServiceDeps, 'gatewayPix' | 'paymentsRepo' | 'ordersRepo' | 'notificarEmpreendedor' | 'avisarCliente'>,
  limiteIdade: Date,
  agora: Date = new Date(),
): Promise<void> {
  const pendentes = await deps.paymentsRepo.listarPendentesAntesDe(limiteIdade);

  for (const pagamento of pendentes) {
    const consulta = await deps.gatewayPix.consultarPagamento(pagamento.idTransacaoExterno);
    await aplicarStatusPagamento(deps, pagamento, mapearStatusMercadoPago(consulta.statusMp), agora);
  }
}
