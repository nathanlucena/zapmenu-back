import type { Rascunho } from '../../conversation/conversation-state.types.js';
import type { GestaoRepository, SnapshotCardapio } from '../gestao.repository.js';

export interface GestaoRepositoryFake extends GestaoRepository {
  /** Rascunhos gravados, na ordem, por empreendedor. */
  salvos: { empreendedorId: string; rascunho: Rascunho }[];
  /** Erro que o próximo salvamento lança (ex.: link já usado por outra loja). */
  erroAoSalvar?: Error;
}

export function criarGestaoRepositoryFake(snapshotInicial?: Partial<SnapshotCardapio>): GestaoRepositoryFake {
  const snapshot: SnapshotCardapio = { cardapioId: 'cardapio-1', categorias: [], itens: [], loja: {}, ...snapshotInicial };
  const salvos: GestaoRepositoryFake['salvos'] = [];

  const fake: GestaoRepositoryFake = {
    salvos,
    async carregarSnapshot() {
      return structuredClone(snapshot);
    },
    async salvarRascunho(empreendedorId, rascunho) {
      const erro = fake.erroAoSalvar;
      if (erro) {
        fake.erroAoSalvar = undefined;
        throw erro;
      }
      salvos.push({ empreendedorId, rascunho: structuredClone(rascunho) });
    },
  };
  return fake;
}
