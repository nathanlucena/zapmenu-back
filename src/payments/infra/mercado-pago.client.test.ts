import { describe, expect, it, vi } from 'vitest';
import { criarMercadoPagoClient } from './mercado-pago.client.js';

function respostaFake(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

const orderPendente = {
  id: 'ORD01HRYFWNYRE1MR1E60MW3X0T2P',
  status: 'action_required',
  status_detail: 'waiting_transfer',
  transactions: {
    payments: [{ id: 'PAY01', payment_method: { id: 'pix', qr_code: 'copia-cola-xyz', qr_code_base64: 'base64img' } }],
  },
};

describe('criarMercadoPagoClient (API de Orders)', () => {
  it('cria a order PIX com valores em texto e devolve o código copia e cola', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaFake(orderPendente));
    const client = criarMercadoPagoClient('token-teste', fetchMock as unknown as typeof fetch);

    const resultado = await client.criarCobrancaPix({
      valor: 25,
      descricao: 'Pedido PED-A8X3',
      referenciaExterna: 'pedido-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.mercadopago.com/v1/orders',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-teste', 'X-Idempotency-Key': 'pedido-1' }),
      }),
    );
    const corpo = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(corpo).toMatchObject({
      type: 'online',
      processing_mode: 'automatic',
      total_amount: '25.00',
      external_reference: 'pedido-1',
      transactions: { payments: [{ amount: '25.00', payment_method: { id: 'pix', type: 'bank_transfer' } }] },
    });
    expect(resultado).toEqual({
      idTransacaoExterno: 'ORD01HRYFWNYRE1MR1E60MW3X0T2P',
      statusMp: 'action_required',
      copiaCola: 'copia-cola-xyz',
      qrCodeBase64: 'base64img',
    });
  });

  it('lança erro quando a criação da cobrança falha', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaFake({}, false, 500));
    const client = criarMercadoPagoClient('token-teste', fetchMock as unknown as typeof fetch);

    await expect(client.criarCobrancaPix({ valor: 10, descricao: 'x', referenciaExterna: 'y' })).rejects.toThrow(
      'Falha ao criar cobrança PIX',
    );
  });

  it('consultarPagamento lê o status da order', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaFake({ id: 'ORD1', status: 'processed', status_detail: 'accredited' }));
    const client = criarMercadoPagoClient('token-teste', fetchMock as unknown as typeof fetch);

    expect(await client.consultarPagamento('ORD1')).toEqual({ statusMp: 'processed' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.mercadopago.com/v1/orders/ORD1', expect.anything());
  });

  it('order vencida vira "expired", seja cancelada ou falha', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaFake({ id: 'ORD1', status: 'canceled', status_detail: 'expired' }));
    const client = criarMercadoPagoClient('token-teste', fetchMock as unknown as typeof fetch);

    expect(await client.consultarPagamento('ORD1')).toEqual({ statusMp: 'expired' });
  });
});
