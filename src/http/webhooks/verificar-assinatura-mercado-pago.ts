import { createHmac, timingSafeEqual } from 'node:crypto';

export interface AssinaturaMercadoPago {
  /** Header x-signature, no formato "ts=1704908010,v1=618c8534...". */
  xSignature?: string;
  /** Header x-request-id. */
  xRequestId?: string;
  /** data.id da notificação (query string). */
  dataId: string;
  segredo: string;
  agora: Date;
  /** Notificações mais antigas que isso são recusadas (proteção contra replay). */
  toleranciaSegundos: number;
}

function lerPartes(xSignature: string): { ts?: string; v1?: string } {
  const partes: Record<string, string> = {};
  for (const parte of xSignature.split(',')) {
    const [chave, valor] = parte.split('=').map((trecho) => trecho.trim());
    if (chave && valor) {
      partes[chave] = valor;
    }
  }
  return { ts: partes.ts, v1: partes.v1 };
}

/**
 * Confere a assinatura que o Mercado Pago manda em cada webhook: HMAC-SHA256,
 * com o segredo da aplicação, do manifesto "id:{data.id};request-id:{x-request-id};ts:{ts};".
 */
export function assinaturaMercadoPagoValida(entrada: AssinaturaMercadoPago): boolean {
  if (!entrada.xSignature || !entrada.xRequestId) {
    return false;
  }
  const { ts, v1 } = lerPartes(entrada.xSignature);
  if (!ts || !v1 || !/^[0-9a-f]+$/i.test(v1)) {
    return false;
  }

  // O ts vem em segundos; aceitamos também milissegundos.
  const tsEmMs = ts.length > 10 ? Number(ts) : Number(ts) * 1000;
  if (!Number.isFinite(tsEmMs) || Math.abs(entrada.agora.getTime() - tsEmMs) > entrada.toleranciaSegundos * 1000) {
    return false;
  }

  // O Mercado Pago pede o data.id em minúsculas quando for alfanumérico.
  const manifesto = `id:${entrada.dataId.toLowerCase()};request-id:${entrada.xRequestId};ts:${ts};`;
  const esperado = createHmac('sha256', entrada.segredo).update(manifesto).digest();
  const recebido = Buffer.from(v1, 'hex');
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}
