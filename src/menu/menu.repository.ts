import type { CardapioPublico, ItemCardapio, ItemDraft } from './menu.types.js';

export type AlteracoesItem = Partial<Pick<ItemDraft, 'nome' | 'descricao' | 'precoBase' | 'imagemUrl'>>;

/**
 * As operações sobre um item recebem também o `cardapioId`: assim um id vindo
 * de fora (ex.: escolhido pela IA) nunca altera item de outro empreendedor.
 */
export interface MenuRepository {
  obterOuCriarCardapio(empreendedorId: string): Promise<{ id: string }>;
  adicionarItem(cardapioId: string, draft: ItemDraft): Promise<ItemCardapio>;
  /** Loja + itens disponíveis agrupados por categoria, para o app do cliente. */
  obterCardapioPublico(empreendedorId: string): Promise<CardapioPublico>;
  /** Itens visíveis para o cliente final (ativos e não removidos). */
  listarItensAtivos(cardapioId: string): Promise<ItemCardapio[]>;
  /** Todos os itens não removidos (inclusive pausados), em ordem de criação. */
  listarItens(cardapioId: string): Promise<ItemCardapio[]>;
  atualizarItem(cardapioId: string, itemId: string, alteracoes: AlteracoesItem): Promise<void>;
  definirAtivo(cardapioId: string, itemId: string, ativo: boolean): Promise<void>;
  removerItem(cardapioId: string, itemId: string): Promise<void>;
}
