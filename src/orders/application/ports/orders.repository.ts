import type { FaltaEstoque, Pedido, ResumoPedidoPublico, StatusDeVenda, StatusPedido } from '../../domain/pedido.js';

export type AlteracoesPedido = Partial<
  Pick<
    Pedido,
    | 'status'
    | 'telefoneCliente'
    | 'confirmadoEm'
    | 'expiraEm'
    | 'enqueteAceiteId'
    | 'enqueteAndamentoId'
    | 'codigoRastreio'
    | 'transportadora'
    | 'etiquetaId'
  >
>;

export interface Venda {
  /** Só registra se o pedido ainda estiver neste status: webhook e poller podem chegar juntos. */
  de: StatusPedido;
  para: StatusDeVenda;
  confirmadoEm: Date;
  /**
   * VENDER_ASSIM_MESMO: o dinheiro já entrou (PIX); baixa o que houver, sem ficar
   * negativo, e grava a falta no pedido. NAO_VENDER: nada muda se faltar.
   */
  seFaltarEstoque: 'VENDER_ASSIM_MESMO' | 'NAO_VENDER';
}

export type ResultadoVenda =
  | { tipo: 'REGISTRADA'; pedido: Pedido }
  /** Outro processo já mudou o status: nada foi baixado de novo. */
  | { tipo: 'JA_REGISTRADA' }
  | { tipo: 'SEM_ESTOQUE'; faltas: FaltaEstoque[] };

export interface OrdersRepository {
  codigoJaExiste(codigoCurto: string): Promise<boolean>;
  criar(pedido: Omit<Pedido, 'id'>): Promise<Pedido>;
  buscarPorId(id: string): Promise<Pedido | null>;
  buscarPorCodigo(codigoCurto: string): Promise<Pedido | null>;
  /** O pedido mais recente desse cliente (pelo telefone), para saber de qual loja ele fala. */
  ultimoDoCliente(telefoneCliente: string): Promise<Pedido | null>;
  /** Pelo id da enquete de aceite ou da de andamento. */
  buscarPorEnquete(enqueteId: string): Promise<Pedido | null>;
  listarPorStatus(status: StatusPedido): Promise<Pedido[]>;
  /**
   * Pedidos criados antes de `limite` que podem concluir sozinhos: status de
   * STATUS_QUE_CONCLUEM_SOZINHOS e sem produto de tamanho/cor (varejo envia, leva dias).
   */
  listarEmAndamentoAntesDe(limite: Date): Promise<Pedido[]>;
  buscarResumoPublico(codigoCurto: string): Promise<ResumoPedidoPublico | null>;
  atualizar(id: string, alteracoes: AlteracoesPedido): Promise<Pedido>;
  /** Só atualiza se o pedido ainda estiver em `de`; null se outro processo já mudou o status. */
  atualizarSeStatus(id: string, de: StatusPedido, alteracoes: AlteracoesPedido): Promise<Pedido | null>;
  listarExpirados(agora: Date): Promise<Pedido[]>;
  /** SKUs do pedido sem estoque para a quantidade pedida agora, sem baixar nada. */
  faltasDeEstoque(id: string): Promise<FaltaEstoque[]>;
  /** Muda o pedido para PAGO/CONFIRMADO e, na mesma transação, dá baixa no estoque dos SKUs. */
  registrarVenda(id: string, venda: Venda): Promise<ResultadoVenda>;
}

export type { StatusPedido };
