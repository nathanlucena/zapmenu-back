import { describe, expect, it, vi } from 'vitest';
import { criarMercadoPagoClient } from './mercado-pago.client.js';

function respostaFake(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

describe('criarMercadoPagoClient', () => {
  it('criarCobrancaPix envia payload correto e mapeia a resposta', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      respostaFake({
        id: 123,
        status: 'pending',
        point_of_interaction: { transaction_data: { qr_code: 'copia-cola-xyz', qr_code_base64: 'base64img' } },
      }),
    );

    const client = criarMercadoPagoClient('token-teste', fetchMock as unknown as typeof fetch);
    const resultado = await client.criarCobrancaPix({
      valor: 25,
      descricao: 'Pedido PED-A8X3',
      referenciaExterna: 'pedido-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.mercadopago.com/v1/payments',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-teste', 'X-Idempotency-Key': 'pedido-1' }),
      }),
    );
    expect(resultado).toEqual({
      idTransacaoExterno: '123',
      statusMp: 'pending',
      copiaCola: 'copia-cola-xyz',
      qrCodeBase64: 'base64img',
    });
  });

  it('lança erro quando a criação da cobrança falha', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaFake({}, false, 500));
    const client = criarMercadoPagoClient('token-teste', fetchMock as unknown as typeof fetch);

    await expect(
      client.criarCobrancaPix({ valor: 10, descricao: 'x', referenciaExterna: 'y' }),
    ).rejects.toThrow('Falha ao criar cobrança PIX');
  });

  it('consultarPagamento retorna o status mapeado da resposta', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaFake({ id: 1, status: 'approved' }));
    const client = criarMercadoPagoClient('token-teste', fetchMock as unknown as typeof fetch);

    const resultado = await client.consultarPagamento('mp-1');

    expect(resultado).toEqual({ statusMp: 'approved' });
  });
});
