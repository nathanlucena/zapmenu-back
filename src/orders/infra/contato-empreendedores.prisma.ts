import type { PrismaClient } from '@prisma/client';
import type { ContatoEmpreendedores } from '../application/ports/avisos-empreendedor.js';

export function criarContatoEmpreendedoresPrisma(prisma: PrismaClient): ContatoEmpreendedores {
  return {
    async telefoneDe(empreendedorId) {
      const empreendedor = await prisma.empreendedor.findUnique({ where: { id: empreendedorId } });
      return empreendedor?.telefone ?? null;
    },
  };
}
