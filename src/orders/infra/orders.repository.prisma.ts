import { Prisma, type PrismaClient } from '@prisma/client';
import type { OrdersRepository, ResultadoVenda } from '../application/ports/orders.repository.js';
import { empreendedorPorIdentificador } from '../../shared/db/identificador-loja.js';
import { DomainError } from '../../shared/errors/domain-error.js';
import {
  STATUS_COM_PRAZO,
  STATUS_QUE_CONCLUEM_SOZINHOS,
  type EnderecoEntrega,
  type FaltaEstoque,
  type ItemPedidoInput,
  type Pedido,
  type ResumoPedidoPublico,
  type StatusPedido,
} from '../domain/pedido.js';

/** Itens com o nome do cardápio, para as mensagens à loja. */
const COM_ITENS = { itens: { include: { itemCardapio: { select: { nome: true } } } } } satisfies Prisma.PedidoInclude;

type PedidoComItens = Prisma.PedidoGetPayload<{ include: typeof COM_ITENS }>;

function paraPedido(pedido: PedidoComItens): Pedido {
  const itens: ItemPedidoInput[] = pedido.itens.map((item) => ({
    itemCardapioId: item.itemCardapioId,
    skuId: item.skuId ?? undefined,
    nome: item.itemCardapio.nome,
    quantidade: item.quantidade,
    precoUnitario: Number(item.precoUnitario),
    variacaoEscolhida: (item.variacaoEscolhida as Record<string, unknown> | null) ?? undefined,
    observacao: item.observacao ?? undefined,
  }));

  return {
    id: pedido.id,
    codigoCurto: pedido.codigoCurto,
    empreendedorId: pedido.empreendedorId,
    telefoneCliente: pedido.telefoneCliente ?? undefined,
    status: pedido.status as StatusPedido,
    modalidade: pedido.modalidade,
    nomeCliente: pedido.nomeCliente ?? undefined,
    observacao: pedido.observacao ?? undefined,
    formaPagamento: pedido.formaPagamento,
    trocoPara: pedido.trocoPara === null ? undefined : Number(pedido.trocoPara),
    taxaEntrega: Number(pedido.taxaEntrega),
    entrega: (pedido.enderecoEntrega as EnderecoEntrega | null) ?? undefined,
    valorTotal: Number(pedido.valorTotal),
    itens,
    expiraEm: pedido.expiraEm,
    criadoEm: pedido.criadoEm,
    confirmadoEm: pedido.confirmadoEm ?? undefined,
    enqueteAceiteId: pedido.enqueteAceiteId ?? undefined,
    enqueteAndamentoId: pedido.enqueteAndamentoId ?? undefined,
    faltaEstoque: (pedido.faltaEstoque as FaltaEstoque[] | null) ?? undefined,
    codigoRastreio: pedido.codigoRastreio ?? undefined,
    transportadora: pedido.transportadora ?? undefined,
  };
}

/** Desfaz a transação da venda quando falta estoque e a regra é não vender. */
class VendaSemEstoque extends Error {
  constructor(public readonly faltas: FaltaEstoque[]) {
    super('venda sem estoque');
  }
}

/** Total de cada SKU no pedido (o mesmo SKU pode estar em mais de uma linha). */
function totalPorSku(itens: { skuId: string | null; quantidade: number }[]): Map<string, number> {
  const total = new Map<string, number>();
  for (const { skuId, quantidade } of itens) {
    if (skuId) {
      total.set(skuId, (total.get(skuId) ?? 0) + quantidade);
    }
  }
  return total;
}

/**
 * Assim como no cardápio público, o identificador de empreendedor recebido aqui
 * é o telefone ou o link curto da loja. Pedido nunca cria empreendedor.
 */
export function criarOrdersRepositoryPrisma(prisma: PrismaClient): OrdersRepository {
  return {
    async codigoJaExiste(codigoCurto: string) {
      const existente = await prisma.pedido.findUnique({ where: { codigoCurto } });
      return existente !== null;
    },

    async criar(dadosPedido: Omit<Pedido, 'id'>) {
      const empreendedor = await prisma.empreendedor.findFirst({
        where: empreendedorPorIdentificador(dadosPedido.empreendedorId),
      });
      if (!empreendedor) {
        throw new DomainError('Loja não encontrada.', 'LOJA_NAO_ENCONTRADA', 'NAO_ENCONTRADO');
      }

      const pedido = await prisma.pedido.create({
        data: {
          codigoCurto: dadosPedido.codigoCurto,
          empreendedorId: empreendedor.id,
          status: dadosPedido.status,
          modalidade: dadosPedido.modalidade,
          nomeCliente: dadosPedido.nomeCliente,
          observacao: dadosPedido.observacao,
          formaPagamento: dadosPedido.formaPagamento ?? 'PIX',
          trocoPara: dadosPedido.trocoPara ?? null,
          taxaEntrega: dadosPedido.taxaEntrega ?? 0,
          enderecoEntrega: (dadosPedido.entrega as unknown as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
          valorTotal: dadosPedido.valorTotal,
          expiraEm: dadosPedido.expiraEm,
          criadoEm: dadosPedido.criadoEm,
          itens: {
            create: dadosPedido.itens.map((item) => ({
              itemCardapio: { connect: { id: item.itemCardapioId } },
              ...(item.skuId && { sku: { connect: { id: item.skuId } } }),
              quantidade: item.quantidade,
              precoUnitario: item.precoUnitario,
              variacaoEscolhida: (item.variacaoEscolhida as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
              observacao: item.observacao ?? null,
            })),
          },
        },
        include: COM_ITENS,
      });

      return paraPedido(pedido);
    },

    async buscarResumoPublico(codigoCurto: string) {
      const pedido = await prisma.pedido.findUnique({
        where: { codigoCurto },
        include: {
          itens: { include: { itemCardapio: { select: { nome: true } } } },
          empreendedor: { select: { loja: { select: { nome: true } } } },
          pagamento: { select: { copiaCola: true, qrCodeBase64: true } },
        },
      });
      if (!pedido) {
        return null;
      }
      const resumo: ResumoPedidoPublico = {
        codigoCurto: pedido.codigoCurto,
        status: pedido.status as StatusPedido,
        modalidade: pedido.modalidade,
        formaPagamento: pedido.formaPagamento,
        trocoPara: pedido.trocoPara === null ? undefined : Number(pedido.trocoPara),
        valorTotal: Number(pedido.valorTotal),
        taxaEntrega: Number(pedido.taxaEntrega),
        expiraEm: pedido.expiraEm,
        criadoEm: pedido.criadoEm,
        nomeLoja: pedido.empreendedor.loja?.nome ?? undefined,
        codigoRastreio: pedido.codigoRastreio ?? undefined,
        transportadora: pedido.transportadora ?? undefined,
        pix:
          pedido.status === 'AGUARDANDO_PAGAMENTO' && pedido.pagamento?.copiaCola
            ? { copiaCola: pedido.pagamento.copiaCola, qrCodeBase64: pedido.pagamento.qrCodeBase64 ?? undefined }
            : undefined,
        itens: pedido.itens.map((item) => ({
          nome: item.itemCardapio.nome,
          quantidade: item.quantidade,
          precoUnitario: Number(item.precoUnitario),
          variacaoEscolhida: (item.variacaoEscolhida as Record<string, unknown> | null) ?? undefined,
          observacao: item.observacao ?? undefined,
        })),
      };
      return resumo;
    },

    async buscarPorId(id: string) {
      const pedido = await prisma.pedido.findUnique({ where: { id }, include: COM_ITENS });
      return pedido ? paraPedido(pedido) : null;
    },

    async buscarPorCodigo(codigoCurto: string) {
      const pedido = await prisma.pedido.findUnique({ where: { codigoCurto }, include: COM_ITENS });
      return pedido ? paraPedido(pedido) : null;
    },

    async ultimoDoCliente(telefoneCliente: string) {
      const pedido = await prisma.pedido.findFirst({ where: { telefoneCliente }, orderBy: { criadoEm: 'desc' }, include: COM_ITENS });
      return pedido ? paraPedido(pedido) : null;
    },

    async buscarPorEnquete(enqueteId: string) {
      const pedido = await prisma.pedido.findFirst({
        where: { OR: [{ enqueteAceiteId: enqueteId }, { enqueteAndamentoId: enqueteId }] },
        include: COM_ITENS,
      });
      return pedido ? paraPedido(pedido) : null;
    },

    async listarPorStatus(status) {
      const pedidos = await prisma.pedido.findMany({ where: { status }, include: COM_ITENS });
      return pedidos.map(paraPedido);
    },

    async listarEmAndamentoAntesDe(limite: Date) {
      const pedidos = await prisma.pedido.findMany({
        where: {
          status: { in: STATUS_QUE_CONCLUEM_SOZINHOS },
          criadoEm: { lt: limite },
          itens: { none: { skuId: { not: null } } },
        },
        include: COM_ITENS,
      });
      return pedidos.map(paraPedido);
    },

    async atualizar(id: string, alteracoes) {
      const pedido = await prisma.pedido.update({ where: { id }, data: alteracoes, include: COM_ITENS });
      return paraPedido(pedido);
    },

    async faltasDeEstoque(id) {
      const itens = await prisma.itemPedido.findMany({
        where: { pedidoId: id, skuId: { not: null } },
        select: { skuId: true, quantidade: true, sku: { select: { estoque: true } } },
      });
      const estoquePorSku = new Map(itens.map((item) => [item.skuId!, Math.max(item.sku?.estoque ?? 0, 0)]));
      return [...totalPorSku(itens)]
        .filter(([skuId, quantidade]) => estoquePorSku.get(skuId)! < quantidade)
        .map(([skuId, quantidade]) => ({ skuId, quantidade, disponivel: estoquePorSku.get(skuId)! }));
    },

    async registrarVenda(id, venda) {
      try {
        return await prisma.$transaction(async (tx): Promise<ResultadoVenda> => {
          // Condicional: a segunda notificação do mesmo pagamento não acha o pedido no status de origem.
          const { count } = await tx.pedido.updateMany({
            where: { id, status: venda.de },
            data: { status: venda.para, confirmadoEm: venda.confirmadoEm },
          });
          if (count === 0) {
            return { tipo: 'JA_REGISTRADA' };
          }

          const pedidos = totalPorSku(await tx.itemPedido.findMany({ where: { pedidoId: id }, select: { skuId: true, quantidade: true } }));
          const ids = [...pedidos.keys()].sort();
          const faltas: FaltaEstoque[] = [];
          if (ids.length > 0) {
            // Trava as linhas (sempre na mesma ordem, sem deadlock) até o fim da transação.
            const estoques = await tx.$queryRaw<{ id: string; estoque: number }[]>`
              SELECT "id", "estoque" FROM "Sku" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
            const estoquePorId = new Map(estoques.map((sku) => [sku.id, sku.estoque]));
            for (const skuId of ids) {
              const quantidade = pedidos.get(skuId)!;
              const disponivel = Math.max(estoquePorId.get(skuId) ?? 0, 0);
              const baixa = Math.min(quantidade, disponivel);
              if (baixa < quantidade) {
                faltas.push({ skuId, quantidade, disponivel });
              }
              if (baixa > 0) {
                // Nunca fica negativo, mesmo se algo escapar da trava.
                await tx.sku.updateMany({ where: { id: skuId, estoque: { gte: baixa } }, data: { estoque: { decrement: baixa } } });
              }
            }
          }

          if (faltas.length > 0) {
            if (venda.seFaltarEstoque === 'NAO_VENDER') {
              throw new VendaSemEstoque(faltas);
            }
            await tx.pedido.update({ where: { id }, data: { faltaEstoque: faltas as unknown as Prisma.InputJsonValue } });
          }
          const pedido = await tx.pedido.findUniqueOrThrow({ where: { id }, include: COM_ITENS });
          return { tipo: 'REGISTRADA', pedido: paraPedido(pedido) };
        });
      } catch (erro) {
        if (erro instanceof VendaSemEstoque) {
          return { tipo: 'SEM_ESTOQUE', faltas: erro.faltas };
        }
        throw erro;
      }
    },

    async atualizarSeStatus(id, de, alteracoes) {
      const { count } = await prisma.pedido.updateMany({ where: { id, status: de }, data: alteracoes });
      if (count === 0) {
        return null;
      }
      const pedido = await prisma.pedido.findUniqueOrThrow({ where: { id }, include: COM_ITENS });
      return paraPedido(pedido);
    },

    async listarExpirados(agora: Date) {
      const pedidos = await prisma.pedido.findMany({
        where: { status: { in: STATUS_COM_PRAZO }, expiraEm: { lt: agora } },
        include: COM_ITENS,
      });
      return pedidos.map(paraPedido);
    },
  };
}
