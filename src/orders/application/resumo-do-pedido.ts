import { descreverFaltas, descreverPagamento, type Pedido } from '../domain/pedido.js';

function reais(valor: number): string {
  return `R$ ${valor.toFixed(2)}`;
}

function textoDaVariacao(variacao: Record<string, unknown> | undefined): string {
  const partes = Object.entries(variacao ?? {}).map(([nome, escolha]) => `${nome}: ${String(escolha)}`);
  return partes.length > 0 ? ` (${partes.join(', ')})` : '';
}

/** "👤 Ana · 📞 wa.me/5581…": o telefone vira link para a loja chamar o cliente no WhatsApp. */
export function linhaDoCliente(pedido: Pick<Pedido, 'nomeCliente' | 'telefoneCliente'>): string | undefined {
  const partes = [
    pedido.nomeCliente && `👤 ${pedido.nomeCliente}`,
    pedido.telefoneCliente && `📞 wa.me/${pedido.telefoneCliente.replace(/\D/g, '')}`,
  ].filter(Boolean);
  return partes.length > 0 ? partes.join(' · ') : undefined;
}

/** Itens, retirada/entrega, observação e total com a forma de pagamento: o que a loja precisa para preparar. */
export function linhasDoPedido(pedido: Pedido): string[] {
  const linhas: string[] = [];
  for (const item of pedido.itens) {
    linhas.push(
      `${item.quantidade}x ${item.nome ?? 'Item'}${textoDaVariacao(item.variacaoEscolhida)} — ${reais(item.precoUnitario * item.quantidade)}`,
    );
    if (item.observacao) {
      linhas.push(`   📝 ${item.observacao}`);
    }
  }
  if (pedido.faltaEstoque?.length) {
    linhas.push(`⚠️ Pago, mas ${descreverFaltas(pedido, pedido.faltaEstoque)}. Combine com o cliente (troca ou devolução).`);
  }
  linhas.push('');
  if (pedido.modalidade === 'ENVIO' && pedido.entrega) {
    const frete = pedido.taxaEntrega ? ` (frete ${reais(pedido.taxaEntrega)})` : '';
    linhas.push(`📦 Enviar pelos Correios para ${pedido.entrega.enderecoFormatado}${frete}`);
  } else if (pedido.modalidade === 'ENTREGA' && pedido.entrega) {
    const taxa = pedido.taxaEntrega ? ` (taxa ${reais(pedido.taxaEntrega)})` : '';
    linhas.push(`🛵 Entrega em ${pedido.entrega.enderecoFormatado}${taxa}`);
  } else {
    linhas.push('🏪 Retirada na loja');
  }
  if (pedido.observacao) {
    linhas.push(`📝 ${pedido.observacao}`);
  }
  linhas.push(`💰 Total: ${reais(pedido.valorTotal)} — ${descreverPagamento(pedido)}`);
  return linhas;
}
