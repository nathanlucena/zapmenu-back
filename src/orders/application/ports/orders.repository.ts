import type { FaltaEstoque, Pedido, ResumoPedidoPublico, StatusDeVenda, StatusPedido } from '../../domain/pedido.js';

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
  /** Pelo id da enquete de aceite ou da de andamento. */
  buscarPorEnquete(enqueteId: string): Promise<Pedido | null>;
  listarPorStatus(status: StatusPedido): Promise<Pedido[]>;
  /** Pedidos em andamento criados antes de `limite`, para concluir sozinhos. */
  listarEmAndamentoAntesDe(limite: Date): Promise<Pedido[]>;
  buscarResumoPublico(codigoCurto: string): Promise<ResumoPedidoPublico | null>;
  atualizar(
    id: string,
    alteracoes: Partial<Pick<Pedido, 'status' | 'telefoneCliente' | 'confirmadoEm' | 'expiraEm' | 'enqueteAceiteId' | 'enqueteAndamentoId'>>,
  ): Promise<Pedido>;
  listarExpirados(agora: Date): Promise<Pedido[]>;
  /** SKUs do pedido sem estoque para a quantidade pedida agora, sem baixar nada. */
  faltasDeEstoque(id: string): Promise<FaltaEstoque[]>;
  /** Muda o pedido para PAGO/CONFIRMADO e, na mesma transação, dá baixa no estoque dos SKUs. */
  registrarVenda(id: string, venda: Venda): Promise<ResultadoVenda>;
}

export type { StatusPedido };
