import { DomainError } from '../../shared/errors/domain-error.js';
import { chaveTelefone } from '../../shared/telefone/telefone.js';
import { estaExpirado, ROTULO_STATUS_PEDIDO, type DecisaoPedido, type Pedido } from '../domain/pedido.js';
import type { ContatoEmpreendedores } from './ports/avisos-empreendedor.js';
import type { OrdersRepository } from './ports/orders.repository.js';

export interface DecidirPedidoDeps {
  ordersRepo: OrdersRepository;
  contatos: ContatoEmpreendedores;
}

/**
 * A loja aceita (o pedido vai para pagamento) ou recusa. Só o dono da loja do
 * pedido decide, e só enquanto o pedido aguarda o aceite.
 */
export async function decidirPedido(
  deps: DecidirPedidoDeps,
  pedido: Pedido,
  decisao: DecisaoPedido,
  telefoneQuemDecide: string,
  agora: Date = new Date(),
): Promise<Pedido> {
  const telefoneDono = await deps.contatos.telefoneDe(pedido.empreendedorId);
  if (!telefoneDono || chaveTelefone(telefoneDono) !== chaveTelefone(telefoneQuemDecide)) {
    throw new DomainError(`O pedido ${pedido.codigoCurto} não é da sua loja.`, 'PEDIDO_DE_OUTRA_LOJA', 'CONFLITO');
  }
  if (estaExpirado(pedido, agora)) {
    throw new DomainError(
      `O pedido ${pedido.codigoCurto} expirou antes da resposta.`,
      'PEDIDO_EXPIRADO',
      'CONFLITO',
    );
  }
  if (pedido.status !== 'AGUARDANDO_ACEITE') {
    throw new DomainError(
      `O pedido ${pedido.codigoCurto} já foi respondido (${ROTULO_STATUS_PEDIDO[pedido.status].toLowerCase()}).`,
      'PEDIDO_JA_DECIDIDO',
      'CONFLITO',
    );
  }

  return deps.ordersRepo.atualizar(pedido.id, {
    status: decisao === 'ACEITAR' ? 'AGUARDANDO_PAGAMENTO' : 'RECUSADO',
  });
}
