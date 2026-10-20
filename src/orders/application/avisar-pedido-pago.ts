import { logger } from '../../shared/logger/logger.js';
import type { Pedido } from '../domain/pedido.js';
import type { ContatoEmpreendedores, MensageiroEmpreendedor } from './ports/avisos-empreendedor.js';

export interface AvisarPedidoPagoDeps {
  contatos: ContatoEmpreendedores;
  mensageiro: MensageiroEmpreendedor;
}

export function montarAvisoPedidoPago(pedido: Pick<Pedido, 'codigoCurto' | 'valorTotal'>): string {
  return `Novo pedido pago! ${pedido.codigoCurto} — R$ ${pedido.valorTotal.toFixed(2)}`;
}

/** Avisa o dono da loja, pelo número de gestão, que um pedido foi pago. */
export async function avisarPedidoPago(deps: AvisarPedidoPagoDeps, pedido: Pedido): Promise<void> {
  const telefone = await deps.contatos.telefoneDe(pedido.empreendedorId);
  if (!telefone) {
    logger.warn({ pedidoId: pedido.id }, 'empreendedor não encontrado para notificação de pedido pago');
    return;
  }
  await deps.mensageiro.enviarTexto(telefone, montarAvisoPedidoPago(pedido));
}
