export interface VariacaoOpcao {
  nome: string;
  precoAdicional: number;
}

export interface VariacaoInput {
  nome: string;
  opcoes: VariacaoOpcao[];
}

export interface ItemDraft {
  nome: string;
  descricao?: string;
  precoBase: number;
  imagemUrl?: string;
  variacoes: VariacaoInput[];
}

export interface FotoProduto {
  url: string;
  ordem: number;
  /** Cor que aparece na foto (varejo). */
  cor?: string;
}

/** Tamanho + cor vendável de um produto, com estoque próprio (varejo). */
export interface Sku {
  id: string;
  tamanho?: string;
  cor?: string;
  estoque: number;
  /** Sobrepõe o precoBase do item. */
  preco?: number;
  ativo: boolean;
}

/** Promoção que vale agora para o item (a vencedora, sem acumular). Só na leitura do cardápio. */
export interface PromocaoDoItem {
  promocaoId: string;
  tipo: 'PRECO_FIXO' | 'PERCENTUAL';
  valor: number;
  /** "Promoção de quarta", "-10%". */
  rotulo: string;
  /** O precoBase com a promoção (as variações somam por cima, como sempre). */
  precoPromocional: number;
}

export interface ItemCardapio extends ItemDraft {
  id: string;
  /** Promoção valendo no momento da leitura; o precoBase continua o normal. */
  promocao?: PromocaoDoItem;
  /** Guia de medidas (loja, Profissional): o do produto, ou o da categoria. */
  guiaMedidas?: { nome: string; colunas: string[]; linhas: { tamanho: string; medidas: number[] }[] };
  cardapioId: string;
  categoriaId?: string;
  ativo: boolean;
  /** Galeria em ordem; sem galeria, só o imagemUrl. Vem na leitura do cardápio. */
  fotos?: FotoProduto[];
  /** Vazio para item sem tamanho/cor (toda comida). Vem na leitura do cardápio. */
  skus?: Sku[];
}

export interface HorarioLoja {
  dia: string;
  abre: string;
  fecha: string;
}

/** Ramo da loja. Lojas antigas são todas COMIDA. */
export type SegmentoLoja = 'COMIDA' | 'VAREJO' | 'SERVICOS';

export interface LojaPublica {
  nome?: string;
  descricao?: string;
  segmento: SegmentoLoja;
  endereco?: string;
  aceitaRetirada: boolean;
  /** Dinheiro ou cartão na entrega/balcão. Opcional: só o cardápio público preenche. */
  aceitaPagamentoNaEntrega?: boolean;
  /** Faltam dados obrigatórios do cadastro: o app mostra "em montagem" e não aceita pedidos. */
  emMontagem?: boolean;
  /** false também para loja antiga que ainda não configurou endereço e faixas. */
  fazEntrega: boolean;
  /** Ordenadas por ateKm; o maior é o limite de entrega. */
  faixasEntrega: { ateKm: number; taxa: number }[];
  raioMaximoKm?: number;
  /** Depreciada: taxa fixa antiga. */
  taxaEntrega?: number;
  pedidoMinimo?: number;
  horarios: HorarioLoja[];
  slug?: string;
  capaUrl?: string;
  logoUrl?: string;
  /** Hex "#RRGGBB". */
  corDestaque?: string;
  /** Perfil do Instagram, sem o @. */
  instagram?: string;
  /** Fuso dos horários, ex.: "America/Sao_Paulo". */
  fuso: string;
  /** Trocas e devoluções, em texto livre (varejo). */
  politicaTroca?: string;
  /** Envia por transportadora (Melhor Envio): o app cota com o CEP do cliente. */
  melhorEnvio?: boolean;
  /** Rodapé "Feito com ZapMenu": o plano da loja não inclui tirar o selo. Só o cardápio público preenche. */
  mostrarSelo?: boolean;
  /** Assinatura suspensa: o app mostra "Loja temporariamente indisponível" e não aceita pedidos. */
  indisponivel?: boolean;
}

/** Uma seção do cardápio; `id` null é o grupo "Outros" (itens sem categoria). */
export interface SecaoCardapio {
  id: string | null;
  nome: string;
  itens: ItemCardapio[];
}

/** O que o app do cliente final precisa para montar o cardápio. */
export interface CardapioPublico {
  loja: LojaPublica | null;
  /** Número do WhatsApp que recebe a confirmação dos pedidos (link wa.me). */
  whatsappPedidos?: string;
  secoes: SecaoCardapio[];
  /** Todos os itens disponíveis, sem agrupamento (compatibilidade). */
  itens: ItemCardapio[];
}
