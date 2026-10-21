import { DomainError } from '../../shared/errors/domain-error.js';
import type { IdempotencyRepository } from '../../shared/idempotency/idempotency.repository.js';
import { logger } from '../../shared/logger/logger.js';
import { confirmarRecebimentoCliente } from '../../orders/application/confirmar-recebimento-cliente.js';
import { extrairCodigoPedido } from '../../orders/domain/pedido.js';
import type { OrdersRepository } from '../../orders/application/ports/orders.repository.js';
import type { Pedido } from '../../orders/domain/pedido.js';
import type { GeradorCobranca } from '../../payments/application/gerar-cobranca.js';
import type { MensagemRecebida, WhatsAppClient } from '../whatsapp-client.interface.js';

const ORIGEM_IDEMPOTENCIA = 'whatsapp_orders';

export interface OrdersInboundRouterDeps {
  whatsapp: WhatsAppClient;
  ordersRepo: OrdersRepository;
  idempotency: IdempotencyRepository;
  geradorCobranca: GeradorCobranca;
  /** Manda o pedido para a loja aceitar ou recusar (resumo + enquete pela gestão). */
  pedirAceite: (pedido: Pedido) => Promise<void>;
  /** Quanto tempo a loja tem para responder. */
  prazoAceiteMs?: number;
}

/** Gera (ou reaproveita) o PIX do pedido e manda para o cliente: copia e cola + QR code. */
export async function enviarPix(
  whatsapp: WhatsAppClient,
  geradorCobranca: GeradorCobranca,
  pedido: Pedido,
  telefone: string,
): Promise<void> {
  const cobranca = await geradorCobranca.gerarCobranca(pedido);
  await whatsapp.sendText(telefone, `Pix copia e cola:\n${cobranca.copiaCola}`);
  if (cobranca.qrCodeBase64) {
    await whatsapp.sendImage(telefone, cobranca.qrCodeBase64, 'QR Code do Pix');
  }
}

async function tratarMensagem(mensagem: MensagemRecebida, deps: OrdersInboundRouterDeps): Promise<void> {
  const codigoCurto = extrairCodigoPedido(mensagem.corpo);
  if (!codigoCurto) {
    logger.info({ telefone: mensagem.telefone }, '🧾 mensagem sem código de pedido');
    await deps.whatsapp.sendText(
      mensagem.telefone,
      'Não encontrei o código do pedido na mensagem. Use o link enviado pelo cardápio.',
    );
    return;
  }

  let pedido: Pedido;
  let repetido: boolean;
  try {
    ({ pedido, repetido } = await confirmarRecebimentoCliente(
      deps.ordersRepo,
      codigoCurto,
      mensagem.telefone,
      new Date(),
      deps.prazoAceiteMs,
    ));
  } catch (erro) {
    if (erro instanceof DomainError) {
      logger.info({ telefone: mensagem.telefone, codigoCurto, motivo: erro.message }, '🧾 pedido não pôde ser confirmado');
      await deps.whatsapp.sendText(mensagem.telefone, erro.message);
      return;
    }
    throw erro;
  }

  if (pedido.status === 'AGUARDANDO_PAGAMENTO') {
    logger.info({ telefone: mensagem.telefone, codigoCurto }, '🧾 código repetido, reenviando o PIX');
    await enviarPix(deps.whatsapp, deps.geradorCobranca, pedido, mensagem.telefone);
    return;
  }
  if (repetido) {
    await deps.whatsapp.sendText(
      mensagem.telefone,
      `Seu pedido ${codigoCurto} ainda está com a loja. Assim que ela aceitar, o PIX chega aqui.`,
    );
    return;
  }

  logger.info({ telefone: mensagem.telefone, codigoCurto, valor: pedido.valorTotal }, '🧾 pedido recebido, pedindo aceite da loja');
  await deps.whatsapp.sendText(
    mensagem.telefone,
    `Recebemos seu pedido ${codigoCurto} ✅\nAgora é só aguardar a loja aceitar — o PIX para pagamento chega aqui em seguida.`,
  );
  await deps.pedirAceite(pedido);
}

export function registrarOrdersInboundRouter(deps: OrdersInboundRouterDeps): void {
  deps.whatsapp.onMessage(async (mensagem) => {
    if (await deps.idempotency.jaProcessado(ORIGEM_IDEMPOTENCIA, mensagem.id)) {
      logger.info({ mensagemId: mensagem.id }, 'mensagem de pedidos já processada (reentrega), ignorando');
      return;
    }

    await tratarMensagem(mensagem, deps);
    await deps.idempotency.marcarProcessado(ORIGEM_IDEMPOTENCIA, mensagem.id);
  });
}
