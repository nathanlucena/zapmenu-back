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
  | { tipo: 'RENOMEAR_CATEGORIA'; categoriaId: string; novoNome: string }
  | { tipo: 'REMOVER_CATEGORIA'; categoriaId: string }
  /** Endereço e taxa fixa não entram aqui: endereço só por DEFINIR_ENDERECO. */
  | { tipo: 'ATUALIZAR_LOJA'; dados: Omit<DadosLoja, 'endereco' | 'enderecoVerificado' | 'taxaEntrega' | 'logoUrl' | 'capaUrl'> }
  /** Só o que a pessoa disse; o código completa pelo CEP e busca no mapa. */
  | { tipo: 'DEFINIR_ENDERECO'; dados: ConsultaEndereco }
  /** Resposta da pessoa ao "é aqui?" do endereço encontrado. */
  | { tipo: 'CONFIRMAR_ENDERECO' | 'RECUSAR_ENDERECO' }
  | { tipo: 'DESCARTAR_TUDO' };

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
