import { DomainError } from '../../shared/errors/domain-error.js';
import { chaveTelefone } from '../../shared/telefone/telefone.js';
import {
  descreverFaltas,
  estaExpirado,
  pagaNaEntrega,
  ROTULO_STATUS_PEDIDO,
  type DecisaoPedido,
  type Pedido,
} from '../domain/pedido.js';
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
  if (!pagaNaEntrega(pedido.formaPagamento)) {
    return deps.ordersRepo.atualizar(pedido.id, { status: 'AGUARDANDO_PAGAMENTO' });
  }
  // Pago na entrega: aceitar já é a venda, então o estoque baixa aqui. Nada foi
  // pago ainda, então, faltando estoque, o pedido não é aceito.
  const venda = await deps.ordersRepo.registrarVenda(pedido.id, {
    de: 'AGUARDANDO_ACEITE',
    para: 'CONFIRMADO',
    confirmadoEm: agora,
    seFaltarEstoque: 'NAO_VENDER',
  });
  if (venda.tipo === 'SEM_ESTOQUE') {
    throw new DomainError(
      `Não dá para aceitar o pedido ${pedido.codigoCurto}: ${descreverFaltas(pedido, venda.faltas)}. Recuse o pedido ou ajuste o estoque.`,
      'SEM_ESTOQUE',
      'CONFLITO',
    );
  }
  if (venda.tipo === 'JA_REGISTRADA') {
    throw new DomainError(`O pedido ${pedido.codigoCurto} já foi respondido.`, 'PEDIDO_JA_DECIDIDO', 'CONFLITO');
  }
  return venda.pedido;
}
