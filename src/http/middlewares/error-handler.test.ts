import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { criarMenuRepositoryFake } from '../../menu/__mocks__/menu.repository.fake.js';
import { criarOrdersRepositoryFake } from '../../orders/__mocks__/orders.repository.fake.js';
import { buildApp } from '../app.js';

/** App cujo cardápio público lança o erro dado, para ver como ele chega na resposta. */
function appQueLanca(erro?: unknown) {
  const menuRepo = criarMenuRepositoryFake();
  if (erro) {
    menuRepo.obterCardapioPublico = async () => {
      throw erro;
    };
  }
  return buildApp({
    menuRepo,
    ordersRepo: criarOrdersRepositoryFake(),
    pedidoTtlMinutos: 20,
    frontendAllowedOrigin: 'http://localhost:3001',
  });
}

const erroPrisma = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('falha', { code, clientVersion: 'teste' });

describe('errorHandler', () => {
  it('JSON malformado é 400 CORPO_INVALIDO, não erro interno', async () => {
    const resposta = await appQueLanca().inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { 'content-type': 'application/json' },
      payload: '{quebrado',
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json()).toMatchObject({ codigo: 'CORPO_INVALIDO' });
  });

  it('corpo acima do limite é 413 CORPO_GRANDE_DEMAIS', async () => {
    const resposta = await appQueLanca().inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ x: 'a'.repeat(1_100_000) }),
    });
    expect(resposta.statusCode).toBe(413);
    expect(resposta.json().codigo).toBe('CORPO_GRANDE_DEMAIS');
  });

  it('rota inexistente responde no mesmo formato, com código', async () => {
    const resposta = await appQueLanca().inject({ method: 'GET', url: '/v1/nao-existe' });
    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toMatchObject({ codigo: 'ROTA_NAO_ENCONTRADA' });
  });

  it.each([
    ['P2002', 409, 'REGISTRO_DUPLICADO'],
    ['P2025', 404, 'REGISTRO_NAO_ENCONTRADO'],
    ['P1001', 503, 'BANCO_INDISPONIVEL'],
  ])('erro %s do Prisma vira %i %s', async (code, status, codigo) => {
    const resposta = await appQueLanca(erroPrisma(code)).inject({ method: 'GET', url: '/v1/menu/emp-1' });
    expect(resposta.statusCode).toBe(status);
    expect(resposta.json().codigo).toBe(codigo);
  });

  it('banco fora do ar na inicialização vira 503', async () => {
    const erro = new Prisma.PrismaClientInitializationError('sem conexão', 'teste');
    const resposta = await appQueLanca(erro).inject({ method: 'GET', url: '/v1/menu/emp-1' });
    expect(resposta.statusCode).toBe(503);
    expect(resposta.json().codigo).toBe('BANCO_INDISPONIVEL');
  });

  it('erro inesperado é 500 ERRO_INTERNO com código de rastreio', async () => {
    const resposta = await appQueLanca(new Error('bug')).inject({ method: 'GET', url: '/v1/menu/emp-1' });
    expect(resposta.statusCode).toBe(500);
    expect(resposta.json()).toMatchObject({ codigo: 'ERRO_INTERNO', rastreio: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(resposta.body).not.toContain('bug');
  });
});
