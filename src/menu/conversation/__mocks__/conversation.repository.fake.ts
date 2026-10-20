import { contextoInicial } from '../conversation-state.types.js';
import type { ConversaPersistida, ConversationRepository } from '../conversation.repository.js';

export interface ConversationRepositoryFake extends ConversationRepository {
  conversaDe(telefone: string): ConversaPersistida | undefined;
}

export function criarConversationRepositoryFake(): ConversationRepositoryFake {
  const conversas = new Map<string, ConversaPersistida>();

  return {
    async obterOuCriar(telefone) {
      const existente = conversas.get(telefone);
      if (existente) {
        return structuredClone(existente);
      }
      const nova: ConversaPersistida = { telefone, estado: 'OCIOSO', contexto: contextoInicial() };
      conversas.set(telefone, nova);
      return structuredClone(nova);
    },
    async salvar(conversa) {
      conversas.set(conversa.telefone, structuredClone(conversa));
    },
    conversaDe(telefone) {
      return conversas.get(telefone);
    },
  };
}
