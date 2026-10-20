import type { PrismaClient } from '@prisma/client';
import type { ConversaPersistida, ConversationRepository } from './conversation.repository.js';
import { contextoInicial, ESTADO_INICIAL, type Contexto, type Estado } from './conversation-state.types.js';

function lerContexto(bruto: unknown): Contexto {
  const contexto = bruto as Partial<Contexto> | null;
  // Contexto de versões anteriores do fluxo (sem rascunho) recomeça do zero.
  if (!contexto?.rascunho || !Array.isArray(contexto.historico)) {
    return contextoInicial();
  }
  return { ...contextoInicial(), ...contexto } as Contexto;
}

export function criarConversationRepositoryPrisma(prisma: PrismaClient): ConversationRepository {
  return {
    async obterOuCriar(telefone: string) {
      const registro = await prisma.estadoConversa.findUnique({ where: { telefone } });
      if (!registro) {
        return { telefone, estado: ESTADO_INICIAL, contexto: contextoInicial() };
      }
      return {
        telefone: registro.telefone,
        empreendedorId: registro.empreendedorId ?? undefined,
        estado: registro.estado as Estado,
        contexto: lerContexto(registro.contexto),
      };
    },

    async salvar(conversa: ConversaPersistida) {
      await prisma.estadoConversa.upsert({
        where: { telefone: conversa.telefone },
        update: { estado: conversa.estado, contexto: conversa.contexto as object, empreendedorId: conversa.empreendedorId },
        create: {
          telefone: conversa.telefone,
          estado: conversa.estado,
          contexto: conversa.contexto as object,
          empreendedorId: conversa.empreendedorId,
        },
      });
    },
  };
}
