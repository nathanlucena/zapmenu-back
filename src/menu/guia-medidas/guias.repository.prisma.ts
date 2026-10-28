import type { Prisma, PrismaClient } from '@prisma/client';
import type { GuiasRepository } from './guias.repository.js';
import type { GuiaMedidas } from './guia-medidas.js';

export function paraGuia(linha: { nome: string; colunas: string[]; linhas: unknown }): GuiaMedidas {
  return { nome: linha.nome, colunas: linha.colunas, linhas: linha.linhas as GuiaMedidas['linhas'] };
}

export function criarGuiasRepositoryPrisma(prisma: PrismaClient): GuiasRepository {
  async function lojaDo(telefone: string) {
    return prisma.loja.findFirst({ where: { empreendedor: { telefone } }, select: { id: true } });
  }
  return {
    async salvar(telefone, alvo, guia) {
      const loja = await lojaDo(telefone);
      if (!loja) throw new Error('Loja não encontrada para o guia de medidas.');
      const chave = alvo.tipo === 'ITEM' ? { itemId: alvo.id } : { categoriaId: alvo.id };
      const dados = { nome: guia.nome, colunas: guia.colunas, linhas: guia.linhas as unknown as Prisma.InputJsonValue };
      await prisma.guiaMedidas.upsert({ where: chave, update: dados, create: { lojaId: loja.id, ...chave, ...dados } });
    },
    async remover(telefone, alvo) {
      const loja = await lojaDo(telefone);
      if (!loja) return false;
      const { count } = await prisma.guiaMedidas.deleteMany({
        where: { lojaId: loja.id, ...(alvo.tipo === 'ITEM' ? { itemId: alvo.id } : { categoriaId: alvo.id }) },
      });
      return count > 0;
    },
  };
}
