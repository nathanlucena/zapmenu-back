import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Previa, PreviasRepository } from './previa.js';

export function criarPreviasRepositoryPrisma(prisma: PrismaClient): PreviasRepository {
  return {
    async guardar(previa, validadeMs) {
      const id = randomUUID();
      await prisma.previaGestao.create({
        data: {
          id,
          dados: previa as unknown as Prisma.InputJsonValue,
          expiraEm: new Date(Date.now() + validadeMs),
        },
      });
      return id;
    },
    async buscar(id, agora = new Date()) {
      const previa = await prisma.previaGestao.findUnique({ where: { id } });
      return previa && previa.expiraEm > agora ? (previa.dados as unknown as Previa) : null;
    },
    async apagarVencidas(agora = new Date()) {
      const { count } = await prisma.previaGestao.deleteMany({ where: { expiraEm: { lt: agora } } });
      return count;
    },
  };
}
