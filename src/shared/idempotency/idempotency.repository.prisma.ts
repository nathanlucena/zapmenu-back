import type { PrismaClient } from '@prisma/client';
import type { IdempotencyRepository } from './idempotency.repository.js';

export function criarIdempotencyRepositoryPrisma(prisma: PrismaClient): IdempotencyRepository {
  return {
    async jaProcessado(origem: string, chaveExterna: string) {
      const existente = await prisma.eventoProcessado.findUnique({
        where: { origem_chaveExterna: { origem, chaveExterna } },
      });
      return existente !== null;
    },

    async marcarProcessado(origem: string, chaveExterna: string) {
      await prisma.eventoProcessado.upsert({
        where: { origem_chaveExterna: { origem, chaveExterna } },
        update: {},
        create: { origem, chaveExterna },
      });
    },
  };
}
