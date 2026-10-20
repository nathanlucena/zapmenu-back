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

const MAPA_STATUS_MP: Record<string, StatusPagamento> = {
  approved: 'APROVADO',
  rejected: 'REJEITADO',
  cancelled: 'REJEITADO',
  refunded: 'REJEITADO',
  charged_back: 'REJEITADO',
  pending: 'PENDENTE',
  in_process: 'PENDENTE',
};

export function mapearStatusMercadoPago(statusMp: string): StatusPagamento {
  return MAPA_STATUS_MP[statusMp] ?? 'PENDENTE';
}
