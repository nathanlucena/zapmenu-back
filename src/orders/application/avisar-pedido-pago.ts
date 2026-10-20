import { logger } from '../../shared/logger/logger.js';
import type { Pedido } from '../domain/pedido.js';
import type { ContatoEmpreendedores, MensageiroEmpreendedor } from './ports/avisos-empreendedor.js';

export interface AvisarPedidoPagoDeps {
  contatos: ContatoEmpreendedores;
  mensageiro: MensageiroEmpreendedor;
}

export function montarAvisoPedidoPago(
  pedido: Pick<Pedido, 'codigoCurto' | 'valorTotal' | 'modalidade' | 'taxaEntrega' | 'entrega' | 'nomeCliente' | 'observacao'>,
): string {
  const linhas = [`Novo pedido pago! ${pedido.codigoCurto} — R$ ${pedido.valorTotal.toFixed(2)}`];
  if (pedido.nomeCliente) {
    linhas.push(`👤 ${pedido.nomeCliente}`);
  }
  if (pedido.modalidade === 'ENTREGA' && pedido.entrega) {
    const taxa = pedido.taxaEntrega ? ` (taxa R$ ${pedido.taxaEntrega.toFixed(2)})` : '';
    linhas.push(`🛵 Entrega em ${pedido.entrega.enderecoFormatado}${taxa}`);
  } else if (pedido.modalidade) {
    linhas.push('🏪 Retirada na loja');
  }
  if (pedido.observacao) {
    linhas.push(`📝 ${pedido.observacao}`);
  }
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
