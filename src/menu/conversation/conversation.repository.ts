import type { Contexto, Estado } from './conversation-state.types.js';

export interface ConversaPersistida {
  telefone: string;
  empreendedorId?: string;
  estado: Estado;
  contexto: Contexto;
}

export interface ConversationRepository {
  obterOuCriar(telefone: string): Promise<ConversaPersistida>;
  salvar(conversa: ConversaPersistida): Promise<void>;
}
