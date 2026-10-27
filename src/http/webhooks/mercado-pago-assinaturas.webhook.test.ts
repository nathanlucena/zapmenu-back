import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { criarMenuRepositoryFake } from '../../menu/__mocks__/menu.repository.fake.js';
import { criarOrdersRepositoryFake } from '../../orders/__mocks__/orders.repository.fake.js';
import { criarAssinaturasRepositoryFake } from '../../planos/__mocks__/assinaturas.repository.fake.js';
import { criarGatewayAssinaturasFake } from '../../planos/__mocks__/gateway-assinaturas.fake.js';
import { criarIdempotencyRepositoryFake } from '../../shared/idempotency/__mocks__/idempotency.repository.fake.js';
import { headersAssinados } from './__mocks__/assinar-webhook-mercado-pago.js';

const SEGREDO_ASSINATURAS = 'segredo-das-assinaturas';

function montar() {
  const repo = criarAssinaturasRepositoryFake();
  repo.definirLoja({ empreendedorId: 'emp-1', telefone: '5581999990000' }, { status: 'TESTE' });
  const gateway = criarGatewayAssinaturasFake();
  const enviados: string[] = [];
  const app = buildApp({
    menuRepo: criarMenuRepositoryFake(),
    ordersRepo: criarOrdersRepositoryFake(),
    pedidoTtlMinutos: 20,
    frontendAllowedOrigin: 'http://localhost:3001',
    planos: {
      repo,
      gateway,
      idempotency: criarIdempotencyRepositoryFake(),
      mensageiro: { enviarTexto: async (_telefone, texto) => void enviados.push(texto) },
    },
    assinaturasWebhookSecret: SEGREDO_ASSINATURAS,
  });
  const notificar = (dataId: string, headers: Record<string, string>, type = 'subscription_preapproval') =>
    app.inject({
      method: 'POST',
      url: `/v1/webhooks/mercado-pago-assinaturas?data.id=${dataId}&type=${type}`,
      headers,
      payload: { id: `notif-${dataId}`, type, action: 'updated', data: { id: dataId } },
    });
  return { repo, gateway, enviados, notificar };
}

describe('POST /v1/webhooks/mercado-pago-assinaturas', () => {
  it('assinatura autorizada ativa o plano da loja', async () => {
    const { repo, gateway, enviados, notificar } = montar();
    gateway.definirAssinatura({ id: 'pre-1', situacao: 'AUTORIZADA', referencia: 'emp-1:ESSENCIAL:MENSAL' });

    const resposta = await notificar('pre-1', headersAssinados('pre-1', SEGREDO_ASSINATURAS));

    expect(resposta.statusCode).toBe(200);
    expect(repo.assinaturaDe('emp-1')).toMatchObject({ status: 'ATIVA', plano: 'ESSENCIAL', mpPreapprovalId: 'pre-1' });
    expect(enviados[0]).toContain('Assinatura confirmada');
  });

  it('recusa assinatura inválida, inclusive a assinada com o segredo das lojas', async () => {
    const { repo, gateway, notificar } = montar();
    gateway.definirAssinatura({ id: 'pre-1', situacao: 'AUTORIZADA', referencia: 'emp-1:ESSENCIAL:MENSAL' });

    expect((await notificar('pre-1', {})).statusCode).toBe(401);
    expect((await notificar('pre-1', headersAssinados('pre-1'))).statusCode).toBe(401);
    expect(repo.assinaturaDe('emp-1')?.status).toBe('TESTE');
  });

  it('assinatura que não é do ZapMenu responde 200 sem mudar nada', async () => {
    const { gateway, notificar } = montar();
    gateway.definirAssinatura({ id: 'pre-x', situacao: 'AUTORIZADA', referencia: 'de-outro-sistema' });
    expect((await notificar('pre-x', headersAssinados('pre-x', SEGREDO_ASSINATURAS))).statusCode).toBe(200);
  });

  it('falha ao consultar o Mercado Pago vira 500 para ele reenviar', async () => {
    const { notificar } = montar();
    const resposta = await notificar('cob-1', headersAssinados('cob-1', SEGREDO_ASSINATURAS), 'subscription_authorized_payment');
    expect(resposta.statusCode).toBe(500);
  });

});
