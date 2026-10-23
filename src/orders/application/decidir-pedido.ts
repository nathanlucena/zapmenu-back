import { DomainError } from '../../shared/errors/domain-error.js';
import { chaveTelefone } from '../../shared/telefone/telefone.js';
import { estaExpirado, pagaNaEntrega, ROTULO_STATUS_PEDIDO, type DecisaoPedido, type Pedido } from '../domain/pedido.js';
import type { ContatoEmpreendedores } from './ports/avisos-empreendedor.js';
import type { OrdersRepository } from './ports/orders.repository.js';

export interface DecidirPedidoDeps {
  ordersRepo: OrdersRepository;
  contatos: ContatoEmpreendedores;
}

/**
 * A loja aceita ou recusa. Aceito, o pedido com PIX vai para pagamento e o
 * pago na entrega fica confirmado. Só o dono da loja do pedido decide, e só
 * enquanto o pedido aguarda o aceite.
 */
/** Só o dono da loja do pedido pode responder ou atualizar o pedido. */
export async function garantirDonoDaLoja(
  contatos: ContatoEmpreendedores,
  pedido: Pick<Pedido, 'empreendedorId' | 'codigoCurto'>,
  telefone: string,
): Promise<void> {
  const telefoneDono = await contatos.telefoneDe(pedido.empreendedorId);
  if (!telefoneDono || chaveTelefone(telefoneDono) !== chaveTelefone(telefone)) {
    throw new DomainError(`O pedido ${pedido.codigoCurto} não é da sua loja.`, 'PEDIDO_DE_OUTRA_LOJA', 'CONFLITO');
  }
}

export async function decidirPedido(
  deps: DecidirPedidoDeps,
  pedido: Pedido,
  decisao: DecisaoPedido,
  telefoneQuemDecide: string,
  agora: Date = new Date(),
): Promise<Pedido> {
  await garantirDonoDaLoja(deps.contatos, pedido, telefoneQuemDecide);
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

  if (decisao === 'RECUSAR') {
    return deps.ordersRepo.atualizar(pedido.id, { status: 'RECUSADO' });
  }
  // TODO(varejo): no CONFIRMADO (pagamento na entrega) o pedido também vira venda:
  // dar baixa no estoque dos SKUs aqui, como no PAGO de confirmar-pagamento.ts.
  return pagaNaEntrega(pedido.formaPagamento)
    ? deps.ordersRepo.atualizar(pedido.id, { status: 'CONFIRMADO', confirmadoEm: agora })
    : deps.ordersRepo.atualizar(pedido.id, { status: 'AGUARDANDO_PAGAMENTO' });
}
