import type { Assinatura as AssinaturaPrisma, Prisma, PrismaClient } from '@prisma/client';
import { FUSO_PADRAO } from '../../orders/domain/horario-loja.js';
import { iniciarTeste, type Assinatura } from '../domain/assinatura.js';
import type { AssinaturaDaLoja, AssinaturasRepository, LojaDaAssinatura } from '../application/ports/assinaturas.repository.js';

/** Id interno, telefone ou link da loja. */
function porIdentificador(identificador: string): Prisma.EmpreendedorWhereInput {
  return { OR: [{ id: identificador }, { telefone: identificador }, { loja: { slug: identificador } }] };
}

const COM_LOJA = { loja: { select: { fuso: true, nome: true } }, assinatura: true } satisfies Prisma.EmpreendedorInclude;
type EmpreendedorComAssinatura = Prisma.EmpreendedorGetPayload<{ include: typeof COM_LOJA }>;

function paraAssinatura(linha: AssinaturaPrisma): Assinatura {
  return {
    empreendedorId: linha.empreendedorId,
    plano: linha.plano,
    periodo: linha.periodo,
    status: linha.status,
    mpPreapprovalId: linha.mpPreapprovalId ?? undefined,
    emailCobranca: linha.emailCobranca ?? undefined,
    fimTeste: linha.fimTeste ?? undefined,
    proximaCobranca: linha.proximaCobranca ?? undefined,
    canceladaEm: linha.canceladaEm ?? undefined,
    planoProximoCiclo: linha.planoProximoCiclo ?? undefined,
    pendenteDesde: linha.pendenteDesde ?? undefined,
    avisoTesteDia: linha.avisoTesteDia ?? undefined,
    avisoCobrancaDia: linha.avisoCobrancaDia ?? undefined,
    avisoPedidos80Mes: linha.avisoPedidos80Mes ?? undefined,
    avisoPedidos100Mes: linha.avisoPedidos100Mes ?? undefined,
  };
}

function paraLoja(empreendedor: EmpreendedorComAssinatura): LojaDaAssinatura {
  return {
    empreendedorId: empreendedor.id,
    telefone: empreendedor.telefone,
    fuso: empreendedor.loja?.fuso ?? FUSO_PADRAO,
    nome: empreendedor.loja?.nome ?? undefined,
  };
}

function paraAssinaturaDaLoja(empreendedor: EmpreendedorComAssinatura): AssinaturaDaLoja {
  return {
    loja: paraLoja(empreendedor),
    assinatura: empreendedor.assinatura ? paraAssinatura(empreendedor.assinatura) : undefined,
  };
}

/** Campos gravados; undefined vira null para limpar o que saiu (ex.: pendenteDesde depois do pagamento). */
function dadosGravados(assinatura: Assinatura) {
  return {
    plano: assinatura.plano,
    periodo: assinatura.periodo,
    status: assinatura.status,
    mpPreapprovalId: assinatura.mpPreapprovalId ?? null,
    emailCobranca: assinatura.emailCobranca ?? null,
    fimTeste: assinatura.fimTeste ?? null,
    proximaCobranca: assinatura.proximaCobranca ?? null,
    canceladaEm: assinatura.canceladaEm ?? null,
    planoProximoCiclo: assinatura.planoProximoCiclo ?? null,
    pendenteDesde: assinatura.pendenteDesde ?? null,
    avisoTesteDia: assinatura.avisoTesteDia ?? null,
    avisoCobrancaDia: assinatura.avisoCobrancaDia ?? null,
    avisoPedidos80Mes: assinatura.avisoPedidos80Mes ?? null,
    avisoPedidos100Mes: assinatura.avisoPedidos100Mes ?? null,
  } satisfies Prisma.AssinaturaUncheckedUpdateInput;
}

export function criarAssinaturasRepositoryPrisma(prisma: PrismaClient): AssinaturasRepository {
  return {
    async obter(identificador) {
      const empreendedor = await prisma.empreendedor.findFirst({ where: porIdentificador(identificador), include: COM_LOJA });
      return empreendedor && paraAssinaturaDaLoja(empreendedor);
    },

    async obterOuIniciarTeste(identificador, agora) {
      const empreendedor = await prisma.empreendedor.findFirst({ where: porIdentificador(identificador), include: COM_LOJA });
      if (!empreendedor) {
        return null;
      }
      if (empreendedor.assinatura) {
        return { loja: paraLoja(empreendedor), assinatura: paraAssinatura(empreendedor.assinatura) };
      }
      const teste = iniciarTeste(empreendedor.id, agora);
      // upsert: duas mensagens ao mesmo tempo não criam duas assinaturas.
      const linha = await prisma.assinatura.upsert({
        where: { empreendedorId: empreendedor.id },
        update: {},
        create: { empreendedorId: empreendedor.id, ...dadosGravados(teste) },
      });
      return { loja: paraLoja(empreendedor), assinatura: paraAssinatura(linha) };
    },

    async porPreapproval(mpPreapprovalId) {
      const linha = await prisma.assinatura.findUnique({
        where: { mpPreapprovalId },
        include: { empreendedor: { include: COM_LOJA } },
      });
      return linha && { loja: paraLoja(linha.empreendedor), assinatura: paraAssinatura(linha) };
    },

    async salvar(assinatura) {
      const dados = dadosGravados(assinatura);
      await prisma.assinatura.upsert({
        where: { empreendedorId: assinatura.empreendedorId },
        update: dados,
        create: { empreendedorId: assinatura.empreendedorId, ...dados },
      });
    },

    async listarParaVerificar() {
      const linhas = await prisma.assinatura.findMany({
        where: { status: { in: ['TESTE', 'PENDENTE', 'CANCELADA'] } },
        include: { empreendedor: { include: COM_LOJA } },
      });
      return linhas.map((linha) => ({ loja: paraLoja(linha.empreendedor), assinatura: paraAssinatura(linha) }));
    },

    // confirmadoEm é gravado justamente quando o pedido vira venda (PAGO ou CONFIRMADO).
    async contarVendas(empreendedorId, de, ate) {
      return prisma.pedido.count({ where: { empreendedorId, confirmadoEm: { gte: de, lt: ate } } });
    },

    async contarProdutos(empreendedorId) {
      return prisma.itemCardapio.count({ where: { removidoEm: null, cardapio: { empreendedorId } } });
    },
  };
}
