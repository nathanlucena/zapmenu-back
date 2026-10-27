import { describe, expect, it, vi } from 'vitest';
import { IntegracaoError } from '../../shared/errors/integracao-error.js';
import { criarMercadoPagoAssinaturasClient } from './mercado-pago-assinaturas.client.js';

function resposta(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

function cliente(fetchMock: ReturnType<typeof vi.fn>, sandbox = true) {
  return criarMercadoPagoAssinaturasClient(
    'TEST-token-zapmenu',
    { urlDeRetorno: 'https://zapmenu.test/assinatura', sandbox },
    fetchMock as unknown as typeof fetch,
  );
}

describe('Mercado Pago Assinaturas (preapproval)', () => {
  it('cria a assinatura pendente com o valor em reais e devolve o link do sandbox', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      resposta({ id: 'pre-1', status: 'pending', init_point: 'https://mp/real', sandbox_init_point: 'https://mp/sandbox' }),
    );

    const criada = await cliente(fetchMock).criar({
      referencia: 'emp-1:PROFISSIONAL:ANUAL',
      email: 'loja@teste.com',
      descricao: 'ZapMenu Profissional (anual)',
      valorCentavos: 59988,
      meses: 12,
      inicio: new Date('2026-11-10T12:00:00Z'),
    });

    expect(criada).toEqual({ id: 'pre-1', linkPagamento: 'https://mp/sandbox' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.mercadopago.com/preapproval');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer TEST-token-zapmenu' });
    expect(JSON.parse(init.body)).toEqual({
      reason: 'ZapMenu Profissional (anual)',
      external_reference: 'emp-1:PROFISSIONAL:ANUAL',
      payer_email: 'loja@teste.com',
      back_url: 'https://zapmenu.test/assinatura',
      status: 'pending',
      auto_recurring: {
        frequency: 12,
        frequency_type: 'months',
        transaction_amount: 599.88,
        currency_id: 'BRL',
        start_date: '2026-11-10T12:00:00.000Z',
      },
    });
  });

  it('fora do sandbox usa o init_point', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resposta({ id: 'pre-1', status: 'pending', init_point: 'https://mp/real', sandbox_init_point: 'https://mp/sandbox' }));
    const criada = await cliente(fetchMock, false).criar({ referencia: 'r', email: 'e@e.com', descricao: 'd', valorCentavos: 2999, meses: 1 });
    expect(criada.linkPagamento).toBe('https://mp/real');
  });

  it('traduz a situação da assinatura e a próxima cobrança', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      resposta({ id: 'pre-1', status: 'authorized', external_reference: 'emp-1:ESSENCIAL:MENSAL', next_payment_date: '2026-11-27T10:00:00.000-03:00' }),
    );
    expect(await cliente(fetchMock).consultar('pre-1')).toEqual({
      id: 'pre-1',
      situacao: 'AUTORIZADA',
      referencia: 'emp-1:ESSENCIAL:MENSAL',
      proximaCobranca: new Date('2026-11-27T13:00:00.000Z'),
    });
  });

  it('cobrança: aprovada, recusada (inclusive em nova tentativa) ou ainda em andamento', async () => {
    const consultar = async (corpo: object) =>
      (await cliente(vi.fn().mockResolvedValue(resposta({ id: 7, preapproval_id: 'pre-1', ...corpo }))).consultarCobranca('7')).situacao;
    expect(await consultar({ status: 'processed', payment: { status: 'approved' } })).toBe('APROVADA');
    expect(await consultar({ status: 'processed', payment: { status: 'rejected' } })).toBe('RECUSADA');
    expect(await consultar({ status: 'recycling' })).toBe('RECUSADA');
    expect(await consultar({ status: 'scheduled' })).toBe('EM_ANDAMENTO');
  });

  it('muda o valor e cancela por PUT', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resposta({}));
    await cliente(fetchMock).alterarValor('pre-1', 2999);
    await cliente(fetchMock).cancelar('pre-1');
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method, JSON.parse(init.body)])).toEqual([
      ['https://api.mercadopago.com/preapproval/pre-1', 'PUT', { auto_recurring: { transaction_amount: 29.99, currency_id: 'BRL' } }],
      ['https://api.mercadopago.com/preapproval/pre-1', 'PUT', { status: 'cancelled' }],
    ]);
  });

  it('erro HTTP vira IntegracaoError do Mercado Pago', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resposta({ message: 'invalid' }, false, 400));
    await expect(cliente(fetchMock).consultar('pre-1')).rejects.toBeInstanceOf(IntegracaoError);
  });
});
