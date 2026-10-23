import { descreverPagamento, pagaNaEntrega, type Pedido } from '../domain/pedido.js';

/** Mensagem ao cliente quando o PIX é aprovado: a partir daqui a loja está preparando. */
export function mensagemPagamentoConfirmado(pedido: Pick<Pedido, 'codigoCurto'>): string {
  return `Pagamento confirmado ✅ A loja já está preparando seu pedido ${pedido.codigoCurto}. Você pode acompanhar pela tela do pedido.`;
}

/** Aviso ao cliente quando a loja atualiza o andamento; undefined quando não há o que avisar. */
export function mensagemAndamento(
  pedido: Pick<
    Pedido,
    'codigoCurto' | 'status' | 'formaPagamento' | 'trocoPara' | 'modalidade' | 'valorTotal' | 'codigoRastreio' | 'transportadora'
  >,
): string | undefined {
  const pagar = pagaNaEntrega(pedido.formaPagamento)
    ? `\nPagamento: ${descreverPagamento(pedido)} — R$ ${pedido.valorTotal.toFixed(2)}.`
    : '';
  switch (pedido.status) {
    case 'SEPARADO':
      return `Seu pedido ${pedido.codigoCurto} foi separado 📦 Avisamos quando ${pedido.modalidade === 'ENTREGA' ? 'sair' : 'estiver pronto para retirar'}.`;
    case 'ENVIADO': {
      const por = !pedido.transportadora
        ? ''
        : pedido.transportadora === 'Correios'
          ? ' pelos Correios'
          : ` pela ${pedido.transportadora}`;
      const rastreio = pedido.codigoRastreio ? `\nCódigo de rastreio: ${pedido.codigoRastreio}` : '';
      return `Seu pedido ${pedido.codigoCurto} foi enviado${por} 🚚${rastreio}${pagar}`;
    }
    case 'SAIU_PARA_ENTREGA':
      return `Seu pedido ${pedido.codigoCurto} saiu para entrega 🛵${pagar}`;
    case 'PRONTO_PARA_RETIRADA':
      return `Seu pedido ${pedido.codigoCurto} está pronto para retirar 🏪${pagar}`;
    case 'CONCLUIDO':
      return `Pedido ${pedido.codigoCurto} concluído. Obrigado pela preferência! 😊`;
    default:
      return undefined;
  }
}
