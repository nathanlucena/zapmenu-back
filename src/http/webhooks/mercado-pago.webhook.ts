import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { processarWebhookPagamento, type PaymentsServiceDeps } from '../../payments/payments.service.js';
import { logger } from '../../shared/logger/logger.js';

const webhookBodySchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  type: z.string().optional(),
  data: z.object({ id: z.union([z.string(), z.number()]) }),
});

export function registerMercadoPagoWebhook(app: FastifyInstance, deps: PaymentsServiceDeps): void {
  app.post('/webhooks/mercado-pago', async (request, reply) => {
    const parseResult = webhookBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ erro: 'Payload de webhook inválido.' });
    }

    const { id: notificacaoId, type: tipo, data } = parseResult.data;
    const idTransacaoExterno = String(data.id);
    const eventoId = notificacaoId ? String(notificacaoId) : `${tipo ?? 'payment'}:${idTransacaoExterno}`;

    const consulta = await deps.mpClient.consultarPagamento(idTransacaoExterno);

    try {
      await processarWebhookPagamento(deps, { eventoId, idTransacaoExterno, statusMp: consulta.statusMp });
    } catch (erro) {
      logger.warn({ err: erro, idTransacaoExterno }, 'Falha ao processar webhook do Mercado Pago');
    }

    return reply.status(200).send({ ok: true });
  });
}
