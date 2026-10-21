import { DomainError } from '../../shared/errors/domain-error.js';
import { estaExpirado, podeTransicionar, type Pedido, type StatusPedido } from '../domain/pedido.js';
import type { OrdersRepository } from './ports/orders.repository.js';

/** Quanto tempo a loja tem para aceitar ou recusar, se ninguém disser outro valor. */
export const PRAZO_ACEITE_PADRAO_MS = 15 * 60_000;

export interface RecebimentoCliente {
  pedido: Pedido;
  /** true quando o cliente mandou o código de novo (pedido já estava com a loja ou aguardando pagamento). */
  repetido: boolean;
}

/** Resposta ao cliente que manda o código de um pedido que não pode mais ser confirmado. */
function motivoSemConfirmacao(codigoCurto: string, status: StatusPedido): string {
  switch (status) {
    case 'PAGO':
      return `O pedido ${codigoCurto} já foi pago ✅`;
    case 'CONFIRMADO':
      return `O pedido ${codigoCurto} já está confirmado ✅ O pagamento é na entrega.`;
    case 'RECUSADO':
      return `A loja não pôde aceitar o pedido ${codigoCurto}. Se quiser, faça um novo pedido pelo cardápio.`;
    case 'CANCELADO':
      return `O pedido ${codigoCurto} foi cancelado pela loja.`;
    default:
      return `O pedido ${codigoCurto} expirou. Faça um novo pedido pelo cardápio.`;
  }
}

/**
 * O cliente mandou o código no WhatsApp: liga o pedido ao telefone dele e o
 * entrega para a loja aceitar, com um novo prazo. Se o pedido já estava com a
 * loja ou aguardando pagamento, devolve sem mudança (`repetido`).
 */
export async function confirmarRecebimentoCliente(
  repositorio: OrdersRepository,
  codigoCurto: string,
  telefoneCliente: string,
  agora: Date = new Date(),
  prazoAceiteMs: number = PRAZO_ACEITE_PADRAO_MS,
): Promise<RecebimentoCliente> {
  const pedido = await repositorio.buscarPorCodigo(codigoCurto);
  if (!pedido) {
    throw new DomainError(
      `Não encontrei o pedido ${codigoCurto}. Confira o código ou faça um novo pedido pelo cardápio.`,
      'PEDIDO_NAO_ENCONTRADO',
      'NAO_ENCONTRADO',
    );
  }
  if (estaExpirado(pedido, agora)) {
    throw new DomainError(motivoSemConfirmacao(codigoCurto, 'EXPIRADO'), 'PEDIDO_EXPIRADO', 'CONFLITO');
  }
  if (pedido.status === 'AGUARDANDO_ACEITE' || pedido.status === 'AGUARDANDO_PAGAMENTO') {
    return { pedido, repetido: true };
  }
  if (!podeTransicionar(pedido.status, 'AGUARDANDO_ACEITE')) {
    throw new DomainError(motivoSemConfirmacao(codigoCurto, pedido.status), 'TRANSICAO_INVALIDA', 'CONFLITO');
  }

  const atualizado = await repositorio.atualizar(pedido.id, {
    status: 'AGUARDANDO_ACEITE',
    telefoneCliente,
    expiraEm: new Date(agora.getTime() + prazoAceiteMs),
  });
  return { pedido: atualizado, repetido: false };
}
