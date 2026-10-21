import { logger } from '../../shared/logger/logger.js';
import type { Pedido } from '../domain/pedido.js';
import type { ContatoEmpreendedores, MensageiroEmpreendedor } from './ports/avisos-empreendedor.js';
import { linhaDoCliente, linhasDoPedido } from './resumo-do-pedido.js';

export interface AvisarPedidoPagoDeps {
  contatos: ContatoEmpreendedores;
  mensageiro: MensageiroEmpreendedor;
}

/**
 * Pedido pago: os dados completos para preparar e o telefone do cliente, com
 * link do WhatsApp, para a loja falar com ele se precisar.
 */
export function montarAvisoPedidoPago(pedido: Pedido): string {
  const linhas = [`✅ Pedido pago! ${pedido.codigoCurto} — R$ ${pedido.valorTotal.toFixed(2)}`];
  const cliente = linhaDoCliente(pedido);
  if (cliente) {
    linhas.push(cliente);
  }
  linhas.push('', ...linhasDoPedido(pedido));
  return linhas.join('\n');
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
