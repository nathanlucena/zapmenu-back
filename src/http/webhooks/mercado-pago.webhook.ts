import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { processarNotificacaoPagamento } from '../../payments/application/processar-notificacao-pagamento.js';
import type { PaymentsServiceDeps } from '../../payments/application/dependencias.js';
import { DomainError } from '../../shared/errors/domain-error.js';
import { logger } from '../../shared/logger/logger.js';
import { assinaturaMercadoPagoValida } from './verificar-assinatura-mercado-pago.js';

const webhookBodySchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  type: z.string().optional(),
  data: z.object({ id: z.union([z.string(), z.number()]) }),
});

export interface OpcoesWebhookMercadoPago {
  segredo: string;
  toleranciaSegundos?: number;
  relogio?: () => Date;
}

function header(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

export function registerMercadoPagoWebhook(
  app: FastifyInstance,
  deps: PaymentsServiceDeps,
  opcoes: OpcoesWebhookMercadoPago,
): void {
  const { segredo, toleranciaSegundos = 300, relogio = () => new Date() } = opcoes;

  app.post('/webhooks/mercado-pago', async (request, reply) => {
    const parseResult = webhookBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ erro: 'Payload de webhook inválido.' });
    }

    // O Mercado Pago assina o data.id que vai na query string; o do corpo é o mesmo.
    const query = request.query as Record<string, string | undefined>;
    const dataIdAssinado = query['data.id'] ?? String(parseResult.data.data.id);
    const assinaturaOk = assinaturaMercadoPagoValida({
      xSignature: header(request.headers['x-signature']),
      xRequestId: header(request.headers['x-request-id']),
      dataId: dataIdAssinado,
      segredo,
      agora: relogio(),
      toleranciaSegundos,
    });
    if (!assinaturaOk) {
      logger.warn({ dataId: dataIdAssinado }, 'webhook do Mercado Pago com assinatura inválida, recusado');
      return reply.status(401).send({ erro: 'Assinatura inválida.' });
    }

    const { id: notificacaoId, type: tipo, data } = parseResult.data;
    const idTransacaoExterno = String(data.id);
    const eventoId = notificacaoId ? String(notificacaoId) : `${tipo ?? 'order'}:${idTransacaoExterno}`;

    try {
      await processarNotificacaoPagamento(deps, { eventoId, idTransacaoExterno });
    } catch (erro) {
      // Notificação de um pagamento que não é nosso: responder 200 evita reenvios
      // inúteis. Qualquer outra falha vira 500 para o Mercado Pago tentar de novo.
      if (!(erro instanceof DomainError)) {
        throw erro;
      }
      logger.warn({ err: erro, idTransacaoExterno }, 'Notificação do Mercado Pago ignorada');
    }

    return reply.status(200).send({ ok: true });
  });
}
