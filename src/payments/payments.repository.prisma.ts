import type { PrismaClient } from '@prisma/client';
import type { PaymentsRepository } from './payments.repository.js';
import type { Pagamento, StatusPagamento } from './payments.types.js';

type PagamentoDb = Awaited<ReturnType<PrismaClient['pagamento']['create']>>;

function paraPagamento(pagamento: PagamentoDb): Pagamento {
  return {
    id: pagamento.id,
    pedidoId: pagamento.pedidoId,
    provedor: pagamento.provedor,
    idTransacaoExterno: pagamento.idTransacaoExterno,
    status: pagamento.status as StatusPagamento,
    qrCodeBase64: pagamento.qrCodeBase64 ?? undefined,
    copiaCola: pagamento.copiaCola ?? undefined,
    criadoEm: pagamento.criadoEm,
    confirmadoEm: pagamento.confirmadoEm ?? undefined,
  };
}

export function criarPaymentsRepositoryPrisma(prisma: PrismaClient): PaymentsRepository {
  return {
    async criar(dados: Omit<Pagamento, 'id'>) {
      const pagamento = await prisma.pagamento.create({
        data: {
          pedidoId: dados.pedidoId,
          provedor: dados.provedor,
          idTransacaoExterno: dados.idTransacaoExterno,
          status: dados.status,
          qrCodeBase64: dados.qrCodeBase64,
          copiaCola: dados.copiaCola,
          criadoEm: dados.criadoEm,
        },
      });
      return paraPagamento(pagamento);
    },

    async buscarPorPedidoId(pedidoId: string) {
      const pagamento = await prisma.pagamento.findUnique({ where: { pedidoId } });
      return pagamento ? paraPagamento(pagamento) : null;
    },

    async buscarPorIdTransacaoExterno(idTransacaoExterno: string) {
      const pagamento = await prisma.pagamento.findUnique({ where: { idTransacaoExterno } });
      return pagamento ? paraPagamento(pagamento) : null;
    },

    async atualizarStatus(id: string, status, confirmadoEm) {
      const pagamento = await prisma.pagamento.update({ where: { id }, data: { status, confirmadoEm } });
      return paraPagamento(pagamento);
    },

    async listarPendentesAntesDe(data: Date) {
      const pagamentos = await prisma.pagamento.findMany({
        where: { status: 'PENDENTE', criadoEm: { lt: data } },
      });
      return pagamentos.map(paraPagamento);
    },
  };
}
