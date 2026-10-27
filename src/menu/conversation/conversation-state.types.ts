/**
 * Etapas da conversa de gestão:
 * - OCIOSO: nenhum rascunho aberto.
 * - CONVERSANDO: a pessoa está descrevendo alterações; elas se acumulam no rascunho.
 * - CONFIRMANDO: o resumo foi mostrado; esperando sim/não.
 */
export type Estado = 'OCIOSO' | 'CONVERSANDO' | 'CONFIRMANDO';

export const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
export type DiaSemana = (typeof DIAS_SEMANA)[number];

export interface Horario {
  dia: DiaSemana;
  /** "HH:MM" */
  abre: string;
  fecha: string;
}

export interface OpcaoVariacao {
  nome: string;
  precoAdicional: number;
}

export interface Variacao {
  nome: string;
  opcoes: OpcaoVariacao[];
}

/** "Até `ateKm` km, cobra `taxa`." A lista fica ordenada por `ateKm`; o maior é o limite de entrega. */
export interface FaixaEntrega {
  ateKm: number;
  taxa: number;
}

/** O que a pessoa informou do endereço até agora (pode estar incompleto ou com erro). */
export interface ConsultaEndereco {
  cep?: string;
  numero?: string;
  /** A pessoa disse que o endereço não tem número ("s/n"). */
  semNumero?: boolean;
  complemento?: string;
  logradouro?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
}

/** Endereço encontrado no mapa, com coordenada. Só o código monta isso (nunca a IA). */
export interface EnderecoVerificado {
  cep?: string;
  logradouro?: string;
  numero: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  /** Texto para exibir no cardápio e no resumo. */
  enderecoFormatado: string;
  latitude: number;
  longitude: number;
  /** `location_type` do Google: ROOFTOP, RANGE_INTERPOLATED, GEOMETRIC_CENTER ou APPROXIMATE. */
  precisao: string;
}

export interface DadosLoja {
  nome?: string;
  descricao?: string;
  /** Texto exibido no cardápio. Com endereço verificado, é o `enderecoFormatado`. */
  endereco?: string;
  enderecoVerificado?: EnderecoVerificado;
  aceitaRetirada?: boolean;
  fazEntrega?: boolean;
  faixasEntrega?: FaixaEntrega[];
  /** Taxa fixa de entrega (todos os planos). */
  taxaEntrega?: number;
  /** Até onde a taxa fixa vale (opcional). */
  raioEntregaKm?: number;
  /** FIXA ou DISTANCIA. Fora do Profissional, vale sempre a taxa fixa. */
  modoEntrega?: 'FIXA' | 'DISTANCIA';
  pedidoMinimo?: number;
  horarios?: Horario[];
  /** Endereço curto do cardápio. Sem ele, um é gerado pelo nome da loja ao salvar. */
  slug?: string;
  /** Hex "#RRGGBB". */
  corDestaque?: string;
  /** Perfil do Instagram, sem o @. */
  instagram?: string;
  /** Foto do logo (data URI), vinda de uma foto mandada na conversa. */
  logoUrl?: string;
  /** Foto de capa (data URI), vinda de uma foto mandada na conversa. */
  capaUrl?: string;
  aceitaPagamentoNaEntrega?: boolean;
  /** Envia pelos Correios com frete fixo (varejo). */
  aceitaEnvio?: boolean;
  /** Frete para qualquer UF sem valor próprio. */
  freteEnvio?: number;
  /** Exceções por UF: { "PE": 12 }. Substitui a lista anterior inteira. */
  fretePorUf?: Record<string, number>;
  /** Trocas e devoluções, em texto livre (loja). */
  politicaTroca?: string;
}

/** Foto nova da galeria de um produto (loja); `cor` liga a foto à cor da grade. */
export interface FotoNova {
  url: string;
  cor?: string;
}

/** Uma combinação vendável de um produto da loja (varejo): vira um SKU com estoque. */
export interface LinhaGrade {
  tamanho?: string;
  cor?: string;
  estoque: number;
  /** Só quando esse tamanho/cor custa diferente do produto. */
  preco?: number;
}

/** Item que ainda não existe no cardápio; `ref` é o apelido usado pela IA (ex.: "n1"). */
export interface NovoItem {
  ref: string;
  nome?: string;
  descricao?: string;
  precoBase?: number;
  /** Nome da categoria (criada no salvamento se ainda não existir); null/ausente = "Outros". */
  categoria?: string | null;
  variacoes?: Variacao[];
  imagemUrl?: string;
  /** Grade completa de tamanhos/cores com estoque (só loja). */
  grade?: LinhaGrade[];
  /** Galeria (só loja), na ordem em que as fotos chegaram. */
  fotos?: FotoNova[];
}

/** Alterações num item existente; só os campos presentes mudam. */
export interface EdicaoItem {
  itemId: string;
  nome?: string;
  descricao?: string;
  precoBase?: number;
  /** null = tirar da categoria (vai para "Outros"). */
  categoria?: string | null;
  variacoes?: Variacao[];
  imagemUrl?: string;
  /** Substitui a grade inteira; o que sair dela fica pausado (pedidos antigos apontam para ele). */
  grade?: LinhaGrade[];
  /** Fotos que entram no fim da galeria (só loja). */
  fotos?: FotoNova[];
}

export type AcaoStatus = 'PAUSAR' | 'REATIVAR' | 'REMOVER';

export interface Rascunho {
  novosItens: NovoItem[];
  edicoes: EdicaoItem[];
  status: { itemId: string; acao: AcaoStatus }[];
  novasCategorias: string[];
  categoriasRenomeadas: { categoriaId: string; novoNome: string }[];
  categoriasRemovidas: string[];
  loja?: DadosLoja;
}

export interface MensagemHistorico {
  papel: 'usuario' | 'bot';
  texto: string;
}

export interface EnderecoPendente {
  endereco: EnderecoVerificado;
  /** Alertas mostrados na confirmação (precisão baixa, CEP divergente…). */
  avisos: string[];
}

export interface Contexto {
  rascunho: Rascunho;
  /** Últimas mensagens da sessão, enviadas à IA como memória. */
  historico: MensagemHistorico[];
  /** Foto recebida que a IA ainda não associou a nenhum item. */
  fotoPendente?: string;
  /** Foto sem legenda esperando a resposta "item, capa ou logo?". */
  fotoSemDestino?: string;
  /** Partes do endereço já informadas; correções parciais ("o número é 132") se somam a isso. */
  consultaEndereco?: ConsultaEndereco;
  /** Endereço encontrado no mapa esperando o "sim" da pessoa para entrar no rascunho. */
  enderecoPendente?: EnderecoPendente;
  proximaRef: number;
  /** Produto que recebeu a última foto (loja): a próxima foto sem legenda logo em seguida vai para ele. */
  ultimaFoto?: { ref?: string; itemId?: string; em: string };
  /** "mudar tipo da loja" em andamento: sem `para`, esperando a escolha; com `para`, esperando o sim. */
  trocaDeTipo?: { para?: 'COMIDA' | 'VAREJO' };
  /** Conversa da assinatura em andamento: esperando o e-mail do Mercado Pago ou o "sim" de uma mudança. */
  assinatura?:
    | { etapa: 'EMAIL'; plano: 'ESSENCIAL' | 'PROFISSIONAL'; periodo: 'MENSAL' | 'ANUAL' }
    | { etapa: 'CONFIRMAR_MUDANCA'; plano: 'ESSENCIAL' | 'PROFISSIONAL' }
    | { etapa: 'CONFIRMAR_CANCELAMENTO' };
  /** Descrições pela IA: a oferta depois de cadastrar, ou a escolha entre as 2 opções do item atual. */
  descricoes?:
    | { etapa: 'OFERTA'; itemIds: string[] }
    | { etapa: 'ESCOLHA'; fila: string[]; atual: { itemId: string; nome: string; opcoes: [string, string] } };
  /** Promoção mostrada no resumo, esperando o "sim" (duas vezes acima de 50%). Datas em ISO. */
  promocaoPendente?: {
    tipo: 'PRECO_FIXO' | 'PERCENTUAL';
    valor: number;
    alvo: { tipo: 'LOJA' } | { tipo: 'CATEGORIAS'; ids: string[] } | { tipo: 'ITENS'; ids: string[] };
    diasSemana: number[];
    horaInicio?: string;
    horaFim?: string;
    fim?: string;
    confirmacoes: number;
  };
  /** ISO; usado para retomar/expirar rascunhos abandonados. */
  atualizadoEm?: string;
}

export function rascunhoVazio(): Rascunho {
  return {
    novosItens: [],
    edicoes: [],
    status: [],
    novasCategorias: [],
    categoriasRenomeadas: [],
    categoriasRemovidas: [],
  };
}

export function contextoInicial(): Contexto {
  return { rascunho: rascunhoVazio(), historico: [], proximaRef: 1 };
}

export const ESTADO_INICIAL: Estado = 'OCIOSO';
export const CONTEXTO_INICIAL: Contexto = contextoInicial();
