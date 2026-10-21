import { confirmarRecebimentoCliente } from '../application/confirmar-recebimento-cliente.js';
import type { OrdersRepository } from '../application/ports/orders.repository.js';
import type { Pedido } from '../domain/pedido.js';

/** Para testes de pagamento: o cliente manda o código e a loja aceita, deixando o pedido aguardando pagamento. */
export async function levarAoPagamento(
  repositorio: OrdersRepository,
  codigoCurto: string,
  telefoneCliente: string,
  agora: Date = new Date(),
): Promise<Pedido> {
  const { pedido } = await confirmarRecebimentoCliente(repositorio, codigoCurto, telefoneCliente, agora);
  return repositorio.atualizar(pedido.id, { status: 'AGUARDANDO_PAGAMENTO' });
}
