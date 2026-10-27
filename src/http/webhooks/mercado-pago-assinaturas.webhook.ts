import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PlanosDeps } from '../../planos/application/dependencias.js';
import type { GatewayAssinaturas } from '../../planos/application/ports/gateway-assinaturas.js';
import { processarNotificacaoAssinatura } from '../../planos/application/processar-notificacao-assinatura.js';
import { DomainError } from '../../shared/errors/domain-error.js';
import { logger } from '../../shared/logger/logger.js';
import { assinaturaMercadoPagoValida } from './verificar-assinatura-mercado-pago.js';

const corpoSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  type: z.string().optional(),
  action: z.string().optional(),
  data: z.object({ id: z.union([z.string(), z.number()]) }),
});

export interface OpcoesWebhookAssinaturas {
  /** Assinatura secreta do webhook da aplicação do ZapMenu (não é a das lojas). */
  segredo: string;
  toleranciaSegundos?: number;
  relogio?: () => Date;
}

function header(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * Notificações das assinaturas do ZapMenu: subscription_preapproval (cartão
 * autorizado, cancelamento) e subscription_authorized_payment (cada cobrança).
 * Mesma verificação de assinatura e mesmas respostas do webhook do PIX.
 */
export function registerMercadoPagoAssinaturasWebhook(
  app: FastifyInstance,
  deps: PlanosDeps & { gateway: GatewayAssinaturas },
  opcoes: OpcoesWebhookAssinaturas,
): void {
  const { segredo, toleranciaSegundos = 300, relogio = () => new Date() } = opcoes;

  app.post('/webhooks/mercado-pago-assinaturas', async (request, reply) => {
    const corpo = corpoSchema.safeParse(request.body);
    if (!corpo.success) {
      return reply.status(400).send({ erro: 'Payload de webhook inválido.' });
    }
    const query = request.query as Record<string, string | undefined>;
    const recursoId = query['data.id'] ?? String(corpo.data.data.id);
    const valida = assinaturaMercadoPagoValida({
      xSignature: header(request.headers['x-signature']),
      xRequestId: header(request.headers['x-request-id']),
      dataId: recursoId,
      segredo,
      agora: relogio(),
      toleranciaSegundos,
    });
    if (!valida) {
      logger.warn({ recursoId }, 'webhook de assinatura com assinatura inválida, recusado');
      return reply.status(401).send({ erro: 'Assinatura inválida.' });
    }

    const tipo = corpo.data.type ?? query.type ?? query.topic ?? '';
    const eventoId = corpo.data.id ? String(corpo.data.id) : `${tipo}:${corpo.data.action ?? ''}:${recursoId}`;
    try {
      await processarNotificacaoAssinatura(deps, { eventoId, tipo, recursoId });
    } catch (erro) {
      if (!(erro instanceof DomainError)) {
        throw erro;
      }
      logger.warn({ err: erro, recursoId }, 'notificação de assinatura ignorada');
    }
    return reply.status(200).send({ ok: true });
  });
}
