import { describe, expect, it } from 'vitest';
import { criarMenuRepositoryFake } from '../menu/__mocks__/menu.repository.fake.js';
import { criarItem } from '../menu/menu.service.js';
import { criarOrdersRepositoryFake } from '../orders/__mocks__/orders.repository.fake.js';
import { buildApp } from './app.js';

function montarApp() {
  return buildApp({
    menuRepo: criarMenuRepositoryFake(),
    ordersRepo: criarOrdersRepositoryFake(),
    pedidoTtlMinutos: 20,
    frontendAllowedOrigin: 'http://localhost:3001',
  });
}

describe('GET /v1/menu/:empreendedorId', () => {
  it('retorna os itens ativos do cardápio do empreendedor', async () => {
    const menuRepo = criarMenuRepositoryFake();
    await criarItem(menuRepo, 'emp-1', { nome: 'Bolo', precoBase: 25, variacoes: [] });

    const app = buildApp({
      menuRepo,
      ordersRepo: criarOrdersRepositoryFake(),
      pedidoTtlMinutos: 20,
      frontendAllowedOrigin: 'http://localhost:3001',
    });

    const resposta = await app.inject({ method: 'GET', url: '/v1/menu/emp-1' });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().itens).toHaveLength(1);
    expect(resposta.json().itens[0].nome).toBe('Bolo');
  });

  it('retorna lista vazia para empreendedor sem itens', async () => {
    const app = montarApp();
    const resposta = await app.inject({ method: 'GET', url: '/v1/menu/emp-novo' });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().itens).toEqual([]);
  });
});

describe('POST /v1/orders', () => {
  it('cria pedido a partir de um carrinho válido', async () => {
    const app = montarApp();

    const resposta = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        empreendedorId: 'emp-1',
        itens: [{ itemCardapioId: 'item-1', quantidade: 2, precoUnitario: 10 }],
      },
    });

    expect(resposta.statusCode).toBe(201);
    const corpo = resposta.json();
    expect(corpo.pedido.codigoCurto).toMatch(/^PED-[A-Z0-9]{4}$/);
    expect(corpo.pedido.valorTotal).toBe(20);
    expect(corpo.pedido.status).toBe('AGUARDANDO_CONFIRMACAO');
  });

  it('retorna 400 para payload com schema inválido', async () => {
    const app = montarApp();

    const resposta = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: { empreendedorId: 'emp-1', itens: [] },
    });

    expect(resposta.statusCode).toBe(400);
  });
});
