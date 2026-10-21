import type { Pedido, ResumoPedidoPublico, StatusPedido } from '../../domain/pedido.js';

export interface OrdersRepository {
  codigoJaExiste(codigoCurto: string): Promise<boolean>;
  criar(pedido: Omit<Pedido, 'id'>): Promise<Pedido>;
  buscarPorId(id: string): Promise<Pedido | null>;
  buscarPorCodigo(codigoCurto: string): Promise<Pedido | null>;
  /** Pelo id da enquete de aceite ou da de andamento. */
  buscarPorEnquete(enqueteId: string): Promise<Pedido | null>;
  /** Pedidos em andamento criados antes de `limite`, para concluir sozinhos. */
  listarEmAndamentoAntesDe(limite: Date): Promise<Pedido[]>;
  buscarResumoPublico(codigoCurto: string): Promise<ResumoPedidoPublico | null>;
  atualizar(
    id: string,
    alteracoes: Partial<Pick<Pedido, 'status' | 'telefoneCliente' | 'confirmadoEm' | 'expiraEm' | 'enqueteAceiteId' | 'enqueteAndamentoId'>>,
  ): Promise<Pedido>;
  listarExpirados(agora: Date): Promise<Pedido[]>;
}

export type { StatusPedido };
