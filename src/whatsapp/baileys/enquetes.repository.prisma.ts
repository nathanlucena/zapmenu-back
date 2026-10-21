import type { PrismaClient } from '@prisma/client';
import type { EnquetesStore } from './enquete.js';

export function criarEnquetesRepositoryPrisma(prisma: PrismaClient): EnquetesStore {
  return {
    async guardar(enquete) {
      await prisma.enqueteWhatsApp.create({
        data: { id: enquete.id, segredo: enquete.segredo, criadorJid: enquete.criadorJid, opcoes: enquete.opcoes },
      });
    },
    async buscar(id) {
      const enquete = await prisma.enqueteWhatsApp.findUnique({ where: { id } });
      return enquete
        ? { id: enquete.id, segredo: enquete.segredo, criadorJid: enquete.criadorJid, opcoes: enquete.opcoes as string[] }
        : null;
    },
  };
}
