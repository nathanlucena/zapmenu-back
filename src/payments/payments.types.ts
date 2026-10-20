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
