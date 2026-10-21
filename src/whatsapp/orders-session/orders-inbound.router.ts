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
  try {
    pedido = await confirmarRecebimentoCliente(deps.ordersRepo, codigoCurto, mensagem.telefone);
  } catch (erro) {
    if (erro instanceof DomainError) {
      logger.info({ telefone: mensagem.telefone, codigoCurto, motivo: erro.message }, '🧾 pedido não pôde ser confirmado');
      await deps.whatsapp.sendText(mensagem.telefone, erro.message);
      return;
    }
    throw erro;
  }

  logger.info({ telefone: mensagem.telefone, codigoCurto, valor: pedido.valorTotal }, '🧾 pedido confirmado, gerando PIX');
  const cobranca = await deps.geradorCobranca.gerarCobranca(pedido);
  await deps.whatsapp.sendText(mensagem.telefone, `Pix copia e cola:\n${cobranca.copiaCola}`);
  if (cobranca.qrCodeBase64) {
    await deps.whatsapp.sendImage(mensagem.telefone, cobranca.qrCodeBase64, 'QR Code do Pix');
  }
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
