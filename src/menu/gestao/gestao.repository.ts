import type { DadosLoja, Rascunho, Variacao } from '../conversation/conversation-state.types.js';

export interface CategoriaSnapshot {
  id: string;
  nome: string;
}

export interface ItemSnapshot {
  id: string;
  nome: string;
  descricao?: string;
  precoBase: number;
  ativo: boolean;
  temFoto: boolean;
  categoriaId?: string;
  categoriaNome?: string;
  variacoes: Variacao[];
}

/** Foto do cardápio atual de um empreendedor, base para a IA e para o resumo. */
export interface SnapshotCardapio {
  cardapioId: string;
  categorias: CategoriaSnapshot[];
  /** Não removidos, em ordem de criação (a numeração mostrada ao usuário). */
  itens: ItemSnapshot[];
  loja: DadosLoja;
}

export interface GestaoRepository {
  carregarSnapshot(empreendedorId: string): Promise<SnapshotCardapio>;
  /** Grava o rascunho inteiro numa transação: ou tudo entra, ou nada. */
  salvarRascunho(empreendedorId: string, rascunho: Rascunho): Promise<void>;
}
