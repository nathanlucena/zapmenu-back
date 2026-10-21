import { logger } from '../../shared/logger/logger.js';
import { descreverPagamento, type Pedido } from '../domain/pedido.js';
import type { ContatoEmpreendedores, MensageiroEmpreendedor } from './ports/avisos-empreendedor.js';
import type { OrdersRepository } from './ports/orders.repository.js';

export const OPCAO_ACEITAR = 'Aceitar';
export const OPCAO_RECUSAR = 'Recusar';

export interface PedirAceiteDeps {
  ordersRepo: OrdersRepository;
  contatos: ContatoEmpreendedores;
  mensageiro: MensageiroEmpreendedor;
}

function reais(valor: number): string {
  return `R$ ${valor.toFixed(2)}`;
}

function textoDaVariacao(variacao: Record<string, unknown> | undefined): string {
  const partes = Object.entries(variacao ?? {}).map(([nome, escolha]) => `${nome}: ${String(escolha)}`);
  return partes.length > 0 ? ` (${partes.join(', ')})` : '';
}

/** Tudo o que a loja precisa para decidir e preparar: itens, cliente, entrega e total. */
export function montarResumoParaLoja(pedido: Pedido): string {
  const linhas = [`🔔 Novo pedido ${pedido.codigoCurto}`];
  if (pedido.nomeCliente) {
    linhas.push(`👤 ${pedido.nomeCliente}`);
  }
  linhas.push('');
  for (const item of pedido.itens) {
    linhas.push(
      `${item.quantidade}x ${item.nome ?? 'Item'}${textoDaVariacao(item.variacaoEscolhida)} — ${reais(item.precoUnitario * item.quantidade)}`,
    );
    if (item.observacao) {
      linhas.push(`   📝 ${item.observacao}`);
    }
  }
  linhas.push('');
  if (pedido.modalidade === 'ENTREGA' && pedido.entrega) {
    const taxa = pedido.taxaEntrega ? ` (taxa ${reais(pedido.taxaEntrega)})` : '';
    linhas.push(`🛵 Entrega em ${pedido.entrega.enderecoFormatado}${taxa}`);
  } else {
    linhas.push('🏪 Retirada na loja');
  }
  if (pedido.observacao) {
    linhas.push(`📝 ${pedido.observacao}`);
  }
  linhas.push(`💰 Total: ${reais(pedido.valorTotal)} — ${descreverPagamento(pedido)}`);
  linhas.push('');
  linhas.push(`Responda na enquete abaixo ou escreva "aceitar ${pedido.codigoCurto}" / "recusar ${pedido.codigoCurto}".`);
  return linhas.join('\n');
}

/**
 * Manda o pedido para a loja decidir: o resumo e uma enquete Aceitar/Recusar.
 * O id da enquete fica no pedido para o voto encontrar o pedido depois.
 */
export async function pedirAceiteDaLoja(deps: PedirAceiteDeps, pedido: Pedido): Promise<void> {
  const telefone = await deps.contatos.telefoneDe(pedido.empreendedorId);
  if (!telefone) {
    logger.warn({ pedidoId: pedido.id }, 'empreendedor não encontrado para pedir o aceite do pedido');
    return;
  }

  await deps.mensageiro.enviarTexto(telefone, montarResumoParaLoja(pedido));
  const enqueteId = await deps.mensageiro.enviarEnquete?.(telefone, `Aceitar o pedido ${pedido.codigoCurto}?`, [
    OPCAO_ACEITAR,
    OPCAO_RECUSAR,
  ]);
  if (enqueteId) {
    await deps.ordersRepo.atualizar(pedido.id, { enqueteAceiteId: enqueteId });
  }
}
