import type {
  ConsultaEndereco,
  Contexto,
  DadosLoja,
  Estado,
  LinhaGrade,
  MensagemHistorico,
  Rascunho,
  Variacao,
} from '../conversation/conversation-state.types.js';
import type { SegmentoLoja } from '../menu.types.js';
import type { SnapshotCardapio } from './gestao.repository.js';

/** Campos de item que a IA pode informar (novo item ou edição). */
export interface DadosItemOperacao {
  nome?: string;
  descricao?: string;
  precoBase?: number;
  /** Nome da categoria; null = tirar da categoria. */
  categoria?: string | null;
  variacoes?: Variacao[];
  /** Para o frete do Melhor Envio (loja). */
  pesoGramas?: number;
  alturaCm?: number;
  larguraCm?: number;
  comprimentoCm?: number;
}

/**
 * Operações que a IA propõe sobre o rascunho. Ela nunca grava nada: o código
 * valida cada uma, e o rascunho só vai para o banco após o "sim" no resumo.
 */
export type Operacao =
  | { tipo: 'NOVO_ITEM'; ref?: string; dados: DadosItemOperacao }
  | { tipo: 'CORRIGIR_NOVO_ITEM'; ref: string; dados: DadosItemOperacao }
  | { tipo: 'DESCARTAR_NOVO_ITEM'; ref: string }
  | { tipo: 'EDITAR_ITEM'; itemId: string; dados: DadosItemOperacao }
  | { tipo: 'PAUSAR_ITEM' | 'REATIVAR_ITEM' | 'REMOVER_ITEM' | 'DESFAZER_ITEM'; itemId: string }
  /** Na loja, a foto entra na galeria do produto; `cor` vem da legenda ("essa é a azul"). */
  | { tipo: 'ANEXAR_FOTO'; ref?: string; itemId?: string; cor?: string }
  /** Loja: grade completa de tamanhos/cores com estoque de um produto (novo pela ref ou existente). */
  | { tipo: 'DEFINIR_GRADE'; ref?: string; itemId?: string; grade: LinhaGrade[] }
  | { tipo: 'ANEXAR_FOTO_LOJA'; destino: 'LOGO' | 'CAPA' }
  | { tipo: 'NOVA_CATEGORIA'; nome: string }
  /** Guia de medidas (loja): não entra no rascunho; o código mostra a tabela e grava depois do "sim". */
  | { tipo: 'DEFINIR_GUIA_MEDIDAS'; alvo: { tipo: 'CATEGORIA' | 'ITEM'; id: string }; guia: { nome: string; colunas: string[]; linhas: { tamanho: string; medidas: number[] }[] } }
  /** Peso e medidas padrão dos produtos da categoria (loja, frete do Melhor Envio). */
  | { tipo: 'MEDIDAS_DA_CATEGORIA'; categoriaId: string; pesoGramas?: number; alturaCm?: number; larguraCm?: number; comprimentoCm?: number }
  | { tipo: 'RENOMEAR_CATEGORIA'; categoriaId: string; novoNome: string }
  | { tipo: 'REMOVER_CATEGORIA'; categoriaId: string }
  /** Endereço e taxa fixa não entram aqui: endereço só por DEFINIR_ENDERECO. */
  | { tipo: 'ATUALIZAR_LOJA'; dados: Omit<DadosLoja, 'endereco' | 'enderecoVerificado' | 'logoUrl' | 'capaUrl'> }
  /** Só o que a pessoa disse; o código completa pelo CEP e busca no mapa. */
  | { tipo: 'DEFINIR_ENDERECO'; dados: ConsultaEndereco }
  /** Resposta da pessoa ao "é aqui?" do endereço encontrado. */
  | { tipo: 'CONFIRMAR_ENDERECO' | 'RECUSAR_ENDERECO' }
  | { tipo: 'DESCARTAR_TUDO' }
  /** Promoção nova: não entra no rascunho; o código mostra o resumo e grava depois do "sim". */
  | { tipo: 'NOVA_PROMOCAO'; promocao: PromocaoProposta };

/** Promoção como a IA propõe: ids do cardápio, dias 0–6 e a data final "AAAA-MM-DD" (inclusive). */
export interface PromocaoProposta {
  tipo: 'PRECO_FIXO' | 'PERCENTUAL';
  valor: number;
  alvo: { tipo: 'LOJA' } | { tipo: 'CATEGORIAS'; ids: string[] } | { tipo: 'ITENS'; ids: string[] };
  diasSemana: number[];
  horaInicio?: string;
  horaFim?: string;
  ate?: string;
}

export interface EntradaConversa {
  estado: Estado;
  historico: MensagemHistorico[];
  mensagem: string;
  fotoRecebida: boolean;
  fotoPendente: boolean;
  rascunho: Rascunho;
  /** Partes do endereço já informadas e endereço esperando confirmação. */
  endereco: Pick<Contexto, 'consultaEndereco' | 'enderecoPendente'>;
  snapshot: SnapshotCardapio;
  /** Dados obrigatórios que faltam para a loja entrar no ar, com a pergunta sugerida ("Horário de funcionamento: Quais dias…?"). */
  cadastroPendente?: string[];
  /** Tipo da loja: muda o prompt e o que a IA pode propor. Ausente = COMIDA. */
  segmento?: SegmentoLoja;
  /** O plano inclui a entrega por distância (faixas). false: só a taxa fixa. Ausente = inclui. */
  entregaPorDistancia?: boolean;
  /** "2026-10-27 (terça)": para a IA calcular "até domingo" nas promoções. */
  hoje?: string;
}

export interface RespostaConversa {
  /** Texto da IA para a pessoa (pode ser vazio). */
  resposta: string;
  operacoes: Operacao[];
  /** Operações que vieram fora do formato (para log/aviso). */
  operacoesMalformadas: string[];
  /** A IA percebeu que a pessoa terminou de descrever as alterações. */
  finalizou: boolean;
  /** A pessoa pediu para ver o cardápio: o sistema envia a lista logo após a resposta. */
  mostrarCardapio: boolean;
  /** Só na etapa CONFIRMANDO: o que a pessoa respondeu ao resumo. */
  decisao?: 'CONFIRMAR' | 'RECUSAR';
}

export interface InterpretadorMensagem {
  conversar(entrada: EntradaConversa): Promise<RespostaConversa>;
}
