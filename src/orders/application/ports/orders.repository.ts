import type { Pedido, ResumoPedidoPublico, StatusPedido } from '../../domain/pedido.js';

export interface OrdersRepository {
  codigoJaExiste(codigoCurto: string): Promise<boolean>;
  criar(pedido: Omit<Pedido, 'id'>): Promise<Pedido>;
  buscarPorId(id: string): Promise<Pedido | null>;
  buscarPorCodigo(codigoCurto: string): Promise<Pedido | null>;
  buscarResumoPublico(codigoCurto: string): Promise<ResumoPedidoPublico | null>;
  atualizar(
    id: string,
    alteracoes: Partial<Pick<Pedido, 'status' | 'telefoneCliente' | 'confirmadoEm'>>,
  ): Promise<Pedido>;
  listarExpirados(agora: Date): Promise<Pedido[]>;
}

export type { StatusPedido };
