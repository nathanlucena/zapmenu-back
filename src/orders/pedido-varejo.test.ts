import { describe, expect, it } from 'vitest';
import { buildApp } from '../http/app.js';
import { criarMenuRepositoryFake } from '../menu/__mocks__/menu.repository.fake.js';
import { criarItem } from '../menu/menu.service.js';
import { criarOrdersRepositoryFake } from './__mocks__/orders.repository.fake.js';

async function montar() {
  const menuRepo = criarMenuRepositoryFake();
  const ordersRepo = criarOrdersRepositoryFake();
  const camiseta = await criarItem(menuRepo, 'emp-1', { nome: 'Camiseta', precoBase: 60, variacoes: [] });
  const bolo = await criarItem(menuRepo, 'emp-1', { nome: 'Bolo', precoBase: 20, variacoes: [] });
  menuRepo.definirSkus(camiseta.id, [
    { id: 'sku-m-azul', tamanho: 'M', cor: 'Azul', estoque: 2, ativo: true },
    { id: 'sku-g-azul', tamanho: 'G', cor: 'Azul', estoque: 5, preco: 70, ativo: true },
    { id: 'sku-p-azul', tamanho: 'P', cor: 'Azul', estoque: 0, ativo: true },
  ]);
  const app = buildApp({ menuRepo, ordersRepo, pedidoTtlMinutos: 20, frontendAllowedOrigin: 'http://localhost:3001' });
  const pedir = (itens: Record<string, unknown>[]) =>
    app.inject({ method: 'POST', url: '/v1/orders', payload: { empreendedorId: 'emp-1', itens } });
  return { app, pedir, camiseta, bolo };
}

describe('pedido de item com tamanho e cor (SKU)', () => {
  it('grava o SKU, cobra o preço dele e guarda tamanho/cor para a loja', async () => {
    const { pedir, camiseta } = await montar();

    const resposta = await pedir([
      { itemCardapioId: camiseta.id, skuId: 'sku-g-azul', quantidade: 1 },
      { itemCardapioId: camiseta.id, skuId: 'sku-m-azul', quantidade: 2 },
    ]);

    expect(resposta.statusCode).toBe(201);
    const { pedido } = resposta.json();
    expect(pedido.valorTotal).toBe(190);
    expect(pedido.itens).toMatchObject([
      { skuId: 'sku-g-azul', precoUnitario: 70, variacaoEscolhida: { Tamanho: 'G', Cor: 'Azul' } },
      { skuId: 'sku-m-azul', precoUnitario: 60, variacaoEscolhida: { Tamanho: 'M', Cor: 'Azul' } },
    ]);
  });

  it('recusa o pedido sem escolher tamanho e cor', async () => {
    const { pedir, camiseta } = await montar();

    const resposta = await pedir([{ itemCardapioId: camiseta.id, quantidade: 1 }]);

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().codigo).toBe('SKU_OBRIGATORIO');
  });

  it('recusa tamanho/cor esgotado com a mensagem para o cliente', async () => {
    const { pedir, camiseta } = await montar();

    const resposta = await pedir([{ itemCardapioId: camiseta.id, skuId: 'sku-p-azul', quantidade: 1 }]);

    expect(resposta.json()).toMatchObject({ codigo: 'SKU_ESGOTADO', erro: 'Tamanho P azul esgotado em "Camiseta".' });
  });

  it('soma as linhas do mesmo SKU contra o estoque', async () => {
    const { pedir, camiseta } = await montar();

    const resposta = await pedir([
      { itemCardapioId: camiseta.id, skuId: 'sku-m-azul', quantidade: 1, observacao: 'Para presente' },
      { itemCardapioId: camiseta.id, skuId: 'sku-m-azul', quantidade: 2 },
    ]);

    expect(resposta.json().codigo).toBe('SKU_ESGOTADO');
  });

  it('recusa SKU de outro item', async () => {
    const { pedir, bolo } = await montar();

    const resposta = await pedir([{ itemCardapioId: bolo.id, skuId: 'sku-m-azul', quantidade: 1 }]);

    expect(resposta.json().codigo).toBe('SKU_INVALIDO');
  });

  it('item sem SKU segue como antes', async () => {
    const { pedir, bolo } = await montar();

    const resposta = await pedir([{ itemCardapioId: bolo.id, quantidade: 3 }]);

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json().pedido.valorTotal).toBe(60);
    expect(resposta.json().pedido.itens[0].skuId).toBeUndefined();
    expect(resposta.json().pedido.itens[0].variacaoEscolhida).toBeUndefined();
  });

  it('a vitrine mostra os SKUs do produto e lista vazia para comida', async () => {
    const { app } = await montar();

    const [camiseta, bolo] = (await app.inject({ method: 'GET', url: '/v1/menu/emp-1' })).json().itens;

    expect(camiseta.skus).toHaveLength(3);
    expect(camiseta.skus[1]).toEqual({ id: 'sku-g-azul', tamanho: 'G', cor: 'Azul', estoque: 5, preco: 70, ativo: true });
    expect(bolo.skus).toEqual([]);
  });
});
