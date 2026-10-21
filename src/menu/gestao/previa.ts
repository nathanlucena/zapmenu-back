import type { DadosLoja, Rascunho, Variacao } from '../conversation/conversation-state.types.js';
import type { SnapshotCardapio } from './gestao.repository.js';

/** Um item como vai ficar no cardápio depois de salvar. */
export interface ItemDaPrevia {
  nome: string;
  descricao?: string;
  /** Preço base; sem preço ainda, a prévia mostra "sem preço". */
  precoBase?: number;
  imagemUrl?: string;
  categoria?: string;
  variacoes: Variacao[];
  marca: 'NOVO' | 'ALTERADO';
}

/** Cabeçalho da loja como vai ficar (com o que já está salvo por baixo). */
export interface LojaDaPrevia {
  nome?: string;
  descricao?: string;
  corDestaque?: string;
  logoUrl?: string;
  capaUrl?: string;
  /** A loja mudou neste rascunho: a prévia mostra o cabeçalho. */
  alterada: boolean;
}

export interface Previa {
  loja: LojaDaPrevia;
  /** Novos primeiro, depois os editados; no máximo MAX_ITENS_NA_PREVIA. */
  itens: ItemDaPrevia[];
  /** Itens alterados que não couberam na imagem ("+N alterações"). */
  itensOcultos: number;
}

/** Quantos itens cabem na imagem; o resto vira "+N alterações" (e a prévia guardada fica leve). */
export const MAX_ITENS_NA_PREVIA = 4;

const CAMPOS_DO_CABECALHO: (keyof DadosLoja)[] = ['nome', 'descricao', 'corDestaque', 'logoUrl', 'capaUrl'];

/**
 * O que a prévia em imagem mostra: itens novos e editados com os valores
 * finais, e o cabeçalho quando a loja muda. Pausar, reativar, remover e mudar
 * só a categoria não aparecem (o texto do resumo basta). Null quando não há nada para mostrar.
 */
export function montarPrevia(rascunho: Rascunho, snapshot: SnapshotCardapio): Previa | null {
  const novos: ItemDaPrevia[] = rascunho.novosItens
    .filter((novo) => novo.nome)
    .map((novo) => ({
      nome: novo.nome!,
      descricao: novo.descricao,
      precoBase: novo.precoBase,
      imagemUrl: novo.imagemUrl,
      categoria: novo.categoria ?? undefined,
      variacoes: novo.variacoes ?? [],
      marca: 'NOVO',
    }));

  const editados: ItemDaPrevia[] = rascunho.edicoes.flatMap((edicao) => {
    const atual = snapshot.itens.find((item) => item.id === edicao.itemId);
    const mudaOQueAparece = ['nome', 'descricao', 'precoBase', 'variacoes', 'imagemUrl'].some(
      (campo) => edicao[campo as keyof typeof edicao] !== undefined,
    );
    if (!atual || !mudaOQueAparece) {
      return [];
    }
    return [
      {
        nome: edicao.nome ?? atual.nome,
        descricao: edicao.descricao ?? atual.descricao,
        precoBase: edicao.precoBase ?? atual.precoBase,
        imagemUrl: edicao.imagemUrl ?? atual.imagemUrl,
        categoria: (edicao.categoria === undefined ? atual.categoriaNome : edicao.categoria) ?? undefined,
        variacoes: edicao.variacoes ?? atual.variacoes,
        marca: 'ALTERADO' as const,
      },
    ];
  });

  const mudancasDaLoja = rascunho.loja ?? {};
  const lojaAlterada = CAMPOS_DO_CABECALHO.some((campo) => mudancasDaLoja[campo] !== undefined);
  if (!lojaAlterada && novos.length === 0 && editados.length === 0) {
    return null;
  }

  const loja = { ...snapshot.loja, ...definidos(mudancasDaLoja) };
  return {
    loja: {
      nome: loja.nome,
      descricao: loja.descricao,
      corDestaque: loja.corDestaque,
      logoUrl: mudancasDaLoja.logoUrl ?? snapshot.lojaSalva.logoUrl,
      capaUrl: mudancasDaLoja.capaUrl ?? snapshot.lojaSalva.capaUrl,
      alterada: lojaAlterada,
    },
    itens: [...novos, ...editados].slice(0, MAX_ITENS_NA_PREVIA),
    itensOcultos: Math.max(0, novos.length + editados.length - MAX_ITENS_NA_PREVIA),
  };
}

function definidos<T extends object>(objeto: T): Partial<T> {
  return Object.fromEntries(Object.entries(objeto).filter(([, valor]) => valor !== undefined)) as Partial<T>;
}

export interface PreviasRepository {
  /** Guarda a prévia por um tempo e devolve o id (aleatório) dela. */
  guardar(previa: Previa, validadeMs: number): Promise<string>;
  /** Null quando não existe ou já venceu. */
  buscar(id: string, agora?: Date): Promise<Previa | null>;
  apagarVencidas(agora?: Date): Promise<number>;
}
