import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { processarNotificacaoPagamento } from '../../payments/application/processar-notificacao-pagamento.js';
import type { PaymentsServiceDeps } from '../../payments/application/dependencias.js';
import { DomainError } from '../../shared/errors/domain-error.js';
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
