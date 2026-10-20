import { DomainError } from '../../shared/errors/domain-error.js';
import type { PaymentsRepository } from '../application/ports/payments.repository.js';
import type { Pagamento } from '../domain/pagamento.js';

let proximoId = 1;

export function criarPaymentsRepositoryFake(): PaymentsRepository {
  const pagamentos = new Map<string, Pagamento>();

  return {
    async criar(dados: Omit<Pagamento, 'id'>) {
      const pagamento: Pagamento = { ...dados, id: `pagamento-${proximoId++}` };
      pagamentos.set(pagamento.id, pagamento);
      return pagamento;
    },

    async buscarPorPedidoId(pedidoId: string) {
      return Array.from(pagamentos.values()).find((p) => p.pedidoId === pedidoId) ?? null;
    },

    async buscarPorIdTransacaoExterno(idTransacaoExterno: string) {
      return Array.from(pagamentos.values()).find((p) => p.idTransacaoExterno === idTransacaoExterno) ?? null;
    },

    async atualizarStatus(id: string, status, confirmadoEm) {
      const pagamento = pagamentos.get(id);
      if (!pagamento) {
        throw new DomainError(`Pagamento ${id} não encontrado.`, 'PAGAMENTO_NAO_ENCONTRADO');
      }
      const atualizado = { ...pagamento, status, confirmadoEm: confirmadoEm ?? pagamento.confirmadoEm };
      pagamentos.set(id, atualizado);
      return atualizado;
    },

    async listarPendentesAntesDe(data: Date) {
      return Array.from(pagamentos.values()).filter((p) => p.status === 'PENDENTE' && p.criadoEm < data);
    },
  };
}
