import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assinaturaMercadoPagoValida, type AssinaturaMercadoPago } from './verificar-assinatura-mercado-pago.js';

const SEGREDO = 'segredo-de-teste';
const AGORA = new Date('2026-10-17T12:00:00Z');
const TS = String(AGORA.getTime() / 1000);

function assinar(dataId: string, requestId: string, ts: string, segredo = SEGREDO): string {
  const v1 = createHmac('sha256', segredo).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

function entrada(sobrescrever: Partial<AssinaturaMercadoPago> = {}): AssinaturaMercadoPago {
  return {
    xSignature: assinar('123456', 'req-1', TS),
    xRequestId: 'req-1',
    dataId: '123456',
    segredo: SEGREDO,
    agora: AGORA,
    toleranciaSegundos: 300,
    ...sobrescrever,
  };
}

describe('assinaturaMercadoPagoValida', () => {
  it('aceita a assinatura gerada com o segredo certo', () => {
    expect(assinaturaMercadoPagoValida(entrada())).toBe(true);
  });

  it('recusa sem os headers', () => {
    expect(assinaturaMercadoPagoValida(entrada({ xSignature: undefined }))).toBe(false);
    expect(assinaturaMercadoPagoValida(entrada({ xRequestId: undefined }))).toBe(false);
  });

  it('recusa assinatura feita com outro segredo', () => {
    expect(assinaturaMercadoPagoValida(entrada({ xSignature: assinar('123456', 'req-1', TS, 'outro') }))).toBe(false);
  });

  it('recusa quando o data.id não é o assinado', () => {
    expect(assinaturaMercadoPagoValida(entrada({ dataId: '999' }))).toBe(false);
  });

  it('recusa notificação velha demais (replay)', () => {
    const tsAntigo = String(AGORA.getTime() / 1000 - 600);
    expect(assinaturaMercadoPagoValida(entrada({ xSignature: assinar('123456', 'req-1', tsAntigo) }))).toBe(false);
  });

  it('recusa header malformado', () => {
    expect(assinaturaMercadoPagoValida(entrada({ xSignature: 'lixo' }))).toBe(false);
  });
});
