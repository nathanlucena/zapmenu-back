import { DomainError } from '../../shared/errors/domain-error.js';
import type { IdempotencyRepository } from '../../shared/idempotency/idempotency.repository.js';
import { logger } from '../../shared/logger/logger.js';
import { confirmarRecebimentoCliente } from '../../orders/application/confirmar-recebimento-cliente.js';
import { extrairCodigoPedido, pagaNaEntrega } from '../../orders/domain/pedido.js';
import type { OrdersRepository } from '../../orders/application/ports/orders.repository.js';
import type { Pedido } from '../../orders/domain/pedido.js';
import type { GeradorCobranca } from '../../payments/application/gerar-cobranca.js';
import type { MensagemRecebida, WhatsAppClient } from '../whatsapp-client.interface.js';
import { criarAvisoDeFalha } from '../falhas.js';

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
  /** Áudio do cliente vira texto (loja do pedido mais recente dele, no Profissional). Sem isso, pede para escrever. */
  ouvirAudio?: (telefone: string, audio: NonNullable<MensagemRecebida['audio']>) => Promise<{ tipo: 'TEXTO' | 'RESPOSTA'; texto: string }>;
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
      pagaNaEntrega(pedido.formaPagamento)
        ? `Seu pedido ${codigoCurto} ainda está com a loja. Avisamos aqui assim que ela responder.`
        : `Seu pedido ${codigoCurto} ainda está com a loja. Assim que ela aceitar, o PIX chega aqui.`,
    );
    return;
  }

  logger.info({ telefone: mensagem.telefone, codigoCurto, valor: pedido.valorTotal }, '🧾 pedido recebido, pedindo aceite da loja');
  await deps.whatsapp.sendText(
    mensagem.telefone,
    pagaNaEntrega(pedido.formaPagamento)
      ? `Recebemos seu pedido ${codigoCurto} ✅\nAgora é só aguardar a loja aceitar — avisamos aqui assim que ela responder.`
      : `Recebemos seu pedido ${codigoCurto} ✅\nAgora é só aguardar a loja aceitar — o PIX para pagamento chega aqui em seguida.`,
  );
  await deps.pedirAceite(pedido);
}

export function registrarOrdersInboundRouter(deps: OrdersInboundRouterDeps): void {
  const avisarFalha = criarAvisoDeFalha('mensagem de pedido');
  deps.whatsapp.onMessage(async (mensagem) => {
    try {
      if (await deps.idempotency.jaProcessado(ORIGEM_IDEMPOTENCIA, mensagem.id)) {
        logger.info({ mensagemId: mensagem.id }, 'mensagem de pedidos já processada (reentrega), ignorando');
        return;
      }
      if (mensagem.audio) {
        const ouvido = deps.ouvirAudio
          ? await deps.ouvirAudio(mensagem.telefone, mensagem.audio)
          : { tipo: 'RESPOSTA' as const, texto: 'Por aqui ainda não consigo ouvir áudios. Pode escrever?' };
        if (ouvido.tipo === 'RESPOSTA') {
          await deps.whatsapp.sendText(mensagem.telefone, ouvido.texto);
        } else {
          await tratarMensagem({ ...mensagem, corpo: ouvido.texto, audio: undefined }, deps);
        }
        await deps.idempotency.marcarProcessado(ORIGEM_IDEMPOTENCIA, mensagem.id);
        return;
      }
      await tratarMensagem(mensagem, deps);
      await deps.idempotency.marcarProcessado(ORIGEM_IDEMPOTENCIA, mensagem.id);
    } catch (erro) {
      // Sem marcar como processada: se o WhatsApp reentregar ou o cliente mandar de novo, tenta outra vez.
      await avisarFalha(deps.whatsapp, mensagem.telefone, mensagem.id, erro);
    }
  });
}
