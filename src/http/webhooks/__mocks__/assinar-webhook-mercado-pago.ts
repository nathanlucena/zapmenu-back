import { createHmac } from 'node:crypto';

export const SEGREDO_WEBHOOK_TESTE = 'segredo-webhook-teste';

/** Headers que o Mercado Pago mandaria para esta notificação, assinados agora. */
export function headersAssinados(dataId: string, segredo = SEGREDO_WEBHOOK_TESTE): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000));
  const requestId = `req-${dataId}-${ts}`;
  const v1 = createHmac('sha256', segredo)
    .update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`)
    .digest('hex');
  return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
}
