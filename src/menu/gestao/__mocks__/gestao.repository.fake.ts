import type { Rascunho } from '../../conversation/conversation-state.types.js';
import type { GestaoRepository, SnapshotCardapio } from '../gestao.repository.js';

export interface GestaoRepositoryFake extends GestaoRepository {
  /** Rascunhos gravados, na ordem, por empreendedor. */
  salvos: { empreendedorId: string; rascunho: Rascunho }[];
}

export function criarGestaoRepositoryFake(snapshotInicial?: Partial<SnapshotCardapio>): GestaoRepositoryFake {
  const snapshot: SnapshotCardapio = { cardapioId: 'cardapio-1', categorias: [], itens: [], loja: {}, ...snapshotInicial };
  const salvos: GestaoRepositoryFake['salvos'] = [];

  return {
    salvos,
    async carregarSnapshot() {
      return structuredClone(snapshot);
    },
    async salvarRascunho(empreendedorId, rascunho) {
      salvos.push({ empreendedorId, rascunho: structuredClone(rascunho) });
    },
  };
}
