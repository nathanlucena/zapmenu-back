import type { Rascunho } from '../../conversation/conversation-state.types.js';
import { gerarSlug } from '../../vitrine.js';
import type { GestaoRepository, SnapshotCardapio } from '../gestao.repository.js';

export interface GestaoRepositoryFake extends GestaoRepository {
  /** Rascunhos gravados, na ordem, por empreendedor. */
  salvos: { empreendedorId: string; rascunho: Rascunho }[];
  /** Erro que o próximo salvamento lança (ex.: link já usado por outra loja). */
  erroAoSalvar?: Error;
  /** Snapshot atual (o salvar aplica os dados da loja nele, como o banco faria). */
  snapshot: SnapshotCardapio;
}

export const LOJA_SALVA_VAZIA: SnapshotCardapio['lojaSalva'] = {
  existe: false,
  temLogo: false,
  temCapa: false,
  naoLembrarOpcionais: false,
};

export function criarGestaoRepositoryFake(snapshotInicial?: Partial<SnapshotCardapio>): GestaoRepositoryFake {
  const salvos: GestaoRepositoryFake['salvos'] = [];

  const fake: GestaoRepositoryFake = {
    salvos,
    snapshot: {
      cardapioId: 'cardapio-1',
      categorias: [],
      itens: [],
      loja: {},
      lojaSalva: { ...LOJA_SALVA_VAZIA },
      ...snapshotInicial,
    },
    async carregarSnapshot() {
      return structuredClone(fake.snapshot);
    },
    async salvarRascunho(empreendedorId, rascunho) {
      const erro = fake.erroAoSalvar;
      if (erro) {
        fake.erroAoSalvar = undefined;
        throw erro;
      }
      salvos.push({ empreendedorId, rascunho: structuredClone(rascunho) });
      if (rascunho.loja) {
        const { logoUrl, capaUrl, ...dados } = rascunho.loja;
        fake.snapshot.loja = { ...fake.snapshot.loja, ...dados };
        // Como no banco: sem link escolhido, ele sai do nome da loja.
        if (!fake.snapshot.loja.slug && fake.snapshot.loja.nome) {
          fake.snapshot.loja.slug = gerarSlug(fake.snapshot.loja.nome);
        }
        fake.snapshot.lojaSalva = {
          ...fake.snapshot.lojaSalva,
          existe: true,
          temLogo: fake.snapshot.lojaSalva.temLogo || Boolean(logoUrl),
          temCapa: fake.snapshot.lojaSalva.temCapa || Boolean(capaUrl),
        };
      }
    },
    async definirSegmento(_empreendedorId, segmento) {
      fake.snapshot.segmento = segmento;
      fake.snapshot.lojaSalva = { ...fake.snapshot.lojaSalva, existe: true, tipoPendente: false };
    },
    async limparAvisoDoFreteFixo() {
      fake.snapshot.lojaSalva.avisarFimDoFreteFixo = false;
    },
    async registrarLembreteOpcionais(_empreendedorId, registro) {
      if (registro.em) fake.snapshot.lojaSalva.lembreteOpcionaisEm = registro.em;
      if (registro.desligar) fake.snapshot.lojaSalva.naoLembrarOpcionais = true;
    },
  };
  return fake;
}
