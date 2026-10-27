import { Prisma, type PrismaClient } from '@prisma/client';
import type { LojaDoRelatorio, RelatoriosRepository } from '../application/ports/relatorios.repository.js';
import { STATUS_DE_VENDA } from '../domain/relatorio.js';

const COM_DONO = { empreendedor: { include: { assinatura: { select: { plano: true, status: true } } } } } satisfies Prisma.LojaInclude;
type LojaComDono = Prisma.LojaGetPayload<{ include: typeof COM_DONO }>;

function paraLoja(loja: LojaComDono): LojaDoRelatorio {
  return {
    lojaId: loja.id,
    empreendedorId: loja.empreendedorId,
    telefone: loja.empreendedor.telefone,
    fuso: loja.fuso,
    relatorioDiario: loja.relatorioDiario,
    plano: loja.empreendedor.assinatura ?? undefined,
  };
}

export function criarRelatoriosRepositoryPrisma(prisma: PrismaClient): RelatoriosRepository {
  return {
    async lojaDe(identificador) {
      const loja = await prisma.loja.findFirst({
        where: { empreendedor: { OR: [{ id: identificador }, { telefone: identificador }] } },
        include: COM_DONO,
      });
      return loja && paraLoja(loja);
    },

    async listarLojas() {
      const lojas = await prisma.loja.findMany({ include: COM_DONO });
      return lojas.map(paraLoja);
    },

    async vendas(empreendedorId, { de, ate }) {
      const pedidos = await prisma.pedido.findMany({
        where: { empreendedorId, confirmadoEm: { gte: de, lt: ate }, status: { in: [...STATUS_DE_VENDA] } },
        include: { itens: { include: { itemCardapio: { select: { nome: true } } } } },
      });
      return pedidos.map((pedido) => ({
        status: pedido.status,
        valorTotal: Number(pedido.valorTotal),
        criadoEm: pedido.criadoEm,
        modalidade: pedido.modalidade,
        formaPagamento: pedido.formaPagamento,
        itens: pedido.itens.map((item) => ({
          nome: item.itemCardapio.nome,
          quantidade: item.quantidade,
          precoUnitario: Number(item.precoUnitario),
        })),
      }));
    },

    async registrarEnvio(lojaId, tipo, chave, em) {
      try {
        await prisma.relatorioEnviado.create({ data: { lojaId, tipo, chave, enviadoEm: em } });
        return true;
      } catch (erro) {
        // Único repetido: esse relatório já saiu (outro ciclo ou outro processo chegou antes).
        if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
          return false;
        }
        throw erro;
      }
    },

    async definirRelatorioDiario(lojaId, ligado) {
      await prisma.loja.update({ where: { id: lojaId }, data: { relatorioDiario: ligado } });
    },
  };
}
