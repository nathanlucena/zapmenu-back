import type { Prisma, PrismaClient } from '@prisma/client';
import { promocaoDoRegistro, type AlvoPromocao } from '../domain/promocao.js';
import type { LojaDasPromocoes, PromocoesRepository } from '../application/ports/promocoes.repository.js';

const COM_ALVOS = { alvos: true } satisfies Prisma.PromocaoInclude;
const COM_LOJA = { alvos: true, loja: { include: { empreendedor: true } } } satisfies Prisma.PromocaoInclude;

function alvosGravados(alvo: AlvoPromocao): Prisma.PromocaoAlvoCreateWithoutPromocaoInput[] {
  switch (alvo.tipo) {
    case 'LOJA':
      return [];
    case 'CATEGORIAS':
      return alvo.ids.map((id) => ({ categoria: { connect: { id } } }));
    case 'ITENS':
      return alvo.ids.map((id) => ({ item: { connect: { id } } }));
  }
}

function paraLoja(loja: { id: string; fuso: string; empreendedor: { telefone: string } }): LojaDasPromocoes {
  return { lojaId: loja.id, telefone: loja.empreendedor.telefone, fuso: loja.fuso };
}

export function criarPromocoesRepositoryPrisma(prisma: PrismaClient): PromocoesRepository {
  return {
    async lojaDe(identificador) {
      const loja = await prisma.loja.findFirst({
        where: { empreendedor: { OR: [{ id: identificador }, { telefone: identificador }] } },
        include: { empreendedor: true },
      });
      return loja && paraLoja(loja);
    },

    async listar(lojaId) {
      const linhas = await prisma.promocao.findMany({ where: { lojaId }, include: COM_ALVOS, orderBy: { criadaEm: 'asc' } });
      return linhas.map(promocaoDoRegistro);
    },

    async criar(lojaId, nova) {
      const linha = await prisma.promocao.create({
        data: {
          loja: { connect: { id: lojaId } },
          tipo: nova.tipo,
          valor: nova.valor,
          diasSemana: nova.diasSemana,
          horaInicio: nova.horaInicio,
          horaFim: nova.horaFim,
          inicio: nova.inicio,
          fim: nova.fim,
          alvos: { create: alvosGravados(nova.alvo) },
        },
        include: COM_ALVOS,
      });
      return promocaoDoRegistro(linha);
    },

    // Sempre filtrando pela loja: um número escolhido na conversa nunca mexe na promoção de outra loja.
    async definirAtiva(lojaId, promocaoId, ativa) {
      await prisma.promocao.updateMany({ where: { id: promocaoId, lojaId }, data: { ativa } });
    },

    async remover(lojaId, promocaoId) {
      await prisma.promocao.deleteMany({ where: { id: promocaoId, lojaId } });
    },

    async listarVencidas(agora) {
      const linhas = await prisma.promocao.findMany({
        where: { fim: { lt: agora }, OR: [{ ativa: true }, { avisoFimEm: null }] },
        include: COM_LOJA,
      });
      return linhas.map((linha) => ({ loja: paraLoja(linha.loja), promocao: promocaoDoRegistro(linha) }));
    },

    async marcarAvisoFim(promocaoId, em) {
      await prisma.promocao.update({ where: { id: promocaoId }, data: { avisoFimEm: em } });
    },
  };
}
