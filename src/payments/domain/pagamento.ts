export type StatusPagamento = 'PENDENTE' | 'APROVADO' | 'REJEITADO' | 'EXPIRADO';

export interface Pagamento {
  id: string;
  pedidoId: string;
  provedor: string;
  idTransacaoExterno: string;
  status: StatusPagamento;
  qrCodeBase64?: string;
  copiaCola?: string;
  criadoEm: Date;
  confirmadoEm?: Date;
}

/** Status da order na API de Orders do Mercado Pago ("expired" vem do status_detail). */
const MAPA_STATUS_MP: Record<string, StatusPagamento> = {
  processed: 'APROVADO',
  created: 'PENDENTE',
  processing: 'PENDENTE',
  action_required: 'PENDENTE',
  expired: 'EXPIRADO',
  canceled: 'REJEITADO',
  failed: 'REJEITADO',
  refunded: 'REJEITADO',
  charged_back: 'REJEITADO',
};

export function mapearStatusMercadoPago(statusMp: string): StatusPagamento {
  return MAPA_STATUS_MP[statusMp] ?? 'PENDENTE';
}
