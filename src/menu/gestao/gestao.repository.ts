import type { DadosLoja, Rascunho, Variacao } from '../conversation/conversation-state.types.js';
import type { SegmentoLoja } from '../menu.types.js';

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
  /** A foto atual (data URI), só para a prévia em imagem; nunca vai para a IA. */
  imagemUrl?: string;
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
  /** Sem as fotos de logo e capa (pesadas): só se existem. */
  loja: DadosLoja;
  /** Tipo da loja; ausente = COMIDA (lojas anteriores à escolha). */
  segmento?: SegmentoLoja;
  /** O que a gestão precisa saber da loja salva além dos dados editáveis. */
  lojaSalva: {
    existe: boolean;
    temLogo: boolean;
    temCapa: boolean;
    /** Fotos atuais, só para a prévia em imagem. */
    logoUrl?: string;
    capaUrl?: string;
    lembreteOpcionaisEm?: Date;
    naoLembrarOpcionais: boolean;
    /** Loja nova que ainda não escolheu entre cardápio e loja: é a primeira pergunta. */
    tipoPendente?: boolean;
  };
}

export interface GestaoRepository {
  carregarSnapshot(empreendedorId: string): Promise<SnapshotCardapio>;
  /** Grava o rascunho inteiro numa transação: ou tudo entra, ou nada. */
  salvarRascunho(empreendedorId: string, rascunho: Rascunho): Promise<void>;
  /** Grava o tipo escolhido na hora (não passa pelo rascunho): é a base de todo o resto. */
  definirSegmento(empreendedorId: string, segmento: SegmentoLoja): Promise<void>;
  /** Anota o lembrete dos opcionais (data) ou que a loja não quer mais ser lembrada. */
  registrarLembreteOpcionais(empreendedorId: string, registro: { em?: Date; desligar?: boolean }): Promise<void>;
}
