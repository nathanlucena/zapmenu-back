import type { Pedido } from '../domain/pedido.js';

/** Mensagem ao cliente quando o PIX é aprovado: a partir daqui a loja está preparando. */
export function mensagemPagamentoConfirmado(pedido: Pick<Pedido, 'codigoCurto'>): string {
  return `Pagamento confirmado ✅ A loja já está preparando seu pedido ${pedido.codigoCurto}. Você pode acompanhar pela tela do pedido.`;
}
