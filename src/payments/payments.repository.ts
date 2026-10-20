import type { Pagamento, StatusPagamento } from './payments.types.js';

export interface PaymentsRepository {
  criar(pagamento: Omit<Pagamento, 'id'>): Promise<Pagamento>;
  buscarPorPedidoId(pedidoId: string): Promise<Pagamento | null>;
  buscarPorIdTransacaoExterno(idTransacaoExterno: string): Promise<Pagamento | null>;
  atualizarStatus(id: string, status: StatusPagamento, confirmadoEm?: Date): Promise<Pagamento>;
  listarPendentesAntesDe(data: Date): Promise<Pagamento[]>;
}
