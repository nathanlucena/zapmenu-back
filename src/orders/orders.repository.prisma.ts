import { Prisma, type PrismaClient } from '@prisma/client';
import type { OrdersRepository } from './orders.repository.js';
import type { ItemPedidoInput, Pedido, StatusPedido } from './orders.types.js';

type PedidoComItens = Prisma.PedidoGetPayload<{ include: { itens: true } }>;

function paraPedido(pedido: PedidoComItens): Pedido {
  const itens: ItemPedidoInput[] = pedido.itens.map((item) => ({
    itemCardapioId: item.itemCardapioId,
    quantidade: item.quantidade,
    precoUnitario: Number(item.precoUnitario),
    variacaoEscolhida: (item.variacaoEscolhida as Record<string, unknown> | null) ?? undefined,
  }));

  return {
    id: pedido.id,
    codigoCurto: pedido.codigoCurto,
    empreendedorId: pedido.empreendedorId,
    telefoneCliente: pedido.telefoneCliente ?? undefined,
    status: pedido.status as StatusPedido,
    valorTotal: Number(pedido.valorTotal),
    itens,
    expiraEm: pedido.expiraEm,
    criadoEm: pedido.criadoEm,
    confirmadoEm: pedido.confirmadoEm ?? undefined,
  };
}

/**
 * Assim como no menu, o identificador de empreendedor recebido aqui é o
 * telefone; o registro é resolvido/criado antes de gravar o pedido.
 */
export function criarOrdersRepositoryPrisma(prisma: PrismaClient): OrdersRepository {
  return {
    async codigoJaExiste(codigoCurto: string) {
      const existente = await prisma.pedido.findUnique({ where: { codigoCurto } });
      return existente !== null;
    },

    async criar(dadosPedido: Omit<Pedido, 'id'>) {
      const empreendedor = await prisma.empreendedor.upsert({
        where: { telefone: dadosPedido.empreendedorId },
        update: {},
        create: { telefone: dadosPedido.empreendedorId, nome: dadosPedido.empreendedorId },
      });

      const pedido = await prisma.pedido.create({
        data: {
          codigoCurto: dadosPedido.codigoCurto,
          empreendedorId: empreendedor.id,
          status: dadosPedido.status,
          valorTotal: dadosPedido.valorTotal,
          expiraEm: dadosPedido.expiraEm,
          criadoEm: dadosPedido.criadoEm,
          itens: {
            create: dadosPedido.itens.map((item) => ({
              itemCardapio: { connect: { id: item.itemCardapioId } },
              quantidade: item.quantidade,
              precoUnitario: item.precoUnitario,
              variacaoEscolhida: (item.variacaoEscolhida as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
            })),
          },
        },
        include: { itens: true },
      });

      return paraPedido(pedido);
    },

    async buscarPorId(id: string) {
      const pedido = await prisma.pedido.findUnique({ where: { id }, include: { itens: true } });
      return pedido ? paraPedido(pedido) : null;
    },

    async buscarPorCodigo(codigoCurto: string) {
      const pedido = await prisma.pedido.findUnique({ where: { codigoCurto }, include: { itens: true } });
      return pedido ? paraPedido(pedido) : null;
    },

    async atualizar(id: string, alteracoes) {
      const pedido = await prisma.pedido.update({ where: { id }, data: alteracoes, include: { itens: true } });
      return paraPedido(pedido);
    },

    async listarExpirados(agora: Date) {
      const pedidos = await prisma.pedido.findMany({
        where: { status: 'AGUARDANDO_CONFIRMACAO', expiraEm: { lt: agora } },
        include: { itens: true },
      });
      return pedidos.map(paraPedido);
    },
  };
}
