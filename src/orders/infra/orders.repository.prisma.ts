import { Prisma, type PrismaClient } from '@prisma/client';
import type { OrdersRepository } from '../application/ports/orders.repository.js';
import { empreendedorPorIdentificador } from '../../shared/db/identificador-loja.js';
import { DomainError } from '../../shared/errors/domain-error.js';
import {
  STATUS_COM_PRAZO,
  STATUS_EM_ANDAMENTO,
  type EnderecoEntrega,
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
  };
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

    async buscarPorEnquete(enqueteId: string) {
      const pedido = await prisma.pedido.findFirst({
        where: { OR: [{ enqueteAceiteId: enqueteId }, { enqueteAndamentoId: enqueteId }] },
        include: COM_ITENS,
      });
      return pedido ? paraPedido(pedido) : null;
    },

    async listarEmAndamentoAntesDe(limite: Date) {
      const pedidos = await prisma.pedido.findMany({
        where: { status: { in: STATUS_EM_ANDAMENTO }, criadoEm: { lt: limite } },
        include: COM_ITENS,
      });
      return pedidos.map(paraPedido);
    },

    async atualizar(id: string, alteracoes) {
      const pedido = await prisma.pedido.update({ where: { id }, data: alteracoes, include: COM_ITENS });
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
