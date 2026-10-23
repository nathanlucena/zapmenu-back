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

  it('mostra a galeria do produto e, sem galeria, a imagem do item como única foto', async () => {
    const menuRepo = criarMenuRepositoryFake();
    const camiseta = await criarItem(menuRepo, 'emp-1', { nome: 'Camiseta', precoBase: 60, variacoes: [] });
    await criarItem(menuRepo, 'emp-1', { nome: 'Bolo', precoBase: 25, imagemUrl: 'bolo.jpg', variacoes: [] });
    menuRepo.definirFotos(camiseta.id, [
      { url: 'costas.jpg', ordem: 1 },
      { url: 'frente.jpg', ordem: 0, cor: 'Azul' },
    ]);
    const app = buildApp({
      menuRepo,
      ordersRepo: criarOrdersRepositoryFake(),
      pedidoTtlMinutos: 20,
      frontendAllowedOrigin: 'http://localhost:3001',
    });

    const [itemCamiseta, itemBolo] = (await app.inject({ method: 'GET', url: '/v1/menu/emp-1' })).json().itens;

    expect(itemCamiseta.fotos).toEqual([
      { url: 'frente.jpg', ordem: 0, cor: 'Azul' },
      { url: 'costas.jpg', ordem: 1 },
    ]);
    expect(itemBolo.imagemUrl).toBe('bolo.jpg');
    expect(itemBolo.fotos).toEqual([{ url: 'bolo.jpg', ordem: 0 }]);
  });

  it('retorna lista vazia para empreendedor que ainda não cadastrou itens', async () => {
    const menuRepo = criarMenuRepositoryFake();
    await menuRepo.obterOuCriarCardapio('emp-novo');
    const app = buildApp({
      menuRepo,
      ordersRepo: criarOrdersRepositoryFake(),
      pedidoTtlMinutos: 20,
      frontendAllowedOrigin: 'http://localhost:3001',
    });

    const resposta = await app.inject({ method: 'GET', url: '/v1/menu/emp-novo' });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().itens).toEqual([]);
  });

  it('devolve o número de WhatsApp de pedidos para o link wa.me', async () => {
    const menuRepo = criarMenuRepositoryFake();
    await menuRepo.obterOuCriarCardapio('emp-1');
    const app = buildApp({
      menuRepo,
      ordersRepo: criarOrdersRepositoryFake(),
      pedidoTtlMinutos: 20,
      frontendAllowedOrigin: 'http://localhost:3001',
      whatsappPedidos: '5581900001111',
    });

    const resposta = await app.inject({ method: 'GET', url: '/v1/menu/emp-1' });

    expect(resposta.json().whatsappPedidos).toBe('5581900001111');
  });

  it('retorna 404 LOJA_NAO_ENCONTRADA sem criar nada para loja inexistente', async () => {
    const menuRepo = criarMenuRepositoryFake();
    const app = buildApp({
      menuRepo,
      ordersRepo: criarOrdersRepositoryFake(),
      pedidoTtlMinutos: 20,
      frontendAllowedOrigin: 'http://localhost:3001',
    });

    const resposta = await app.inject({ method: 'GET', url: '/v1/menu/inventado' });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json().codigo).toBe('LOJA_NAO_ENCONTRADA');
    expect(await menuRepo.obterCardapioPublico('inventado')).toBeNull();
  });
});

describe('POST /v1/orders', () => {
  async function montarAppComBolo(precoBase = 10) {
    const menuRepo = criarMenuRepositoryFake();
    const bolo = await criarItem(menuRepo, 'emp-1', { nome: 'Bolo', precoBase, variacoes: [] });
    const app = buildApp({
      menuRepo,
      ordersRepo: criarOrdersRepositoryFake(),
      pedidoTtlMinutos: 20,
      frontendAllowedOrigin: 'http://localhost:3001',
    });
    return { app, bolo, menuRepo };
  }

  it('cria pedido a partir de um carrinho válido', async () => {
    const { app, bolo } = await montarAppComBolo();

    const resposta = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: { empreendedorId: 'emp-1', itens: [{ itemCardapioId: bolo.id, quantidade: 2 }] },
    });

    expect(resposta.statusCode).toBe(201);
    const corpo = resposta.json();
    expect(corpo.pedido.codigoCurto).toMatch(/^PED-[A-Z0-9]{4}$/);
    expect(corpo.pedido.valorTotal).toBe(20);
    expect(corpo.pedido.status).toBe('AGUARDANDO_CONFIRMACAO');
  });

  it('usa o preço do cardápio e ignora o precoUnitario enviado pelo cliente', async () => {
    const { app, bolo } = await montarAppComBolo(10);

    const resposta = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: { empreendedorId: 'emp-1', itens: [{ itemCardapioId: bolo.id, quantidade: 1, precoUnitario: 0.01 }] },
    });

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json().pedido.valorTotal).toBe(10);
  });

  it('recusa item que não está no cardápio com ITEM_INDISPONIVEL', async () => {
    const { app } = await montarAppComBolo();

    const resposta = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: { empreendedorId: 'emp-1', itens: [{ itemCardapioId: 'item-inexistente', quantidade: 1 }] },
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().codigo).toBe('ITEM_INDISPONIVEL');
  });

  it('aceita pagamento em dinheiro na entrega, com troco', async () => {
    const { app, bolo } = await montarAppComBolo(30);

    const resposta = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        empreendedorId: 'emp-1',
        itens: [{ itemCardapioId: bolo.id, quantidade: 1 }],
        formaPagamento: 'DINHEIRO',
        trocoPara: 50,
      },
    });

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json().pedido).toMatchObject({ formaPagamento: 'DINHEIRO', trocoPara: 50 });
  });

  it('recusa troco menor que o total e pagamento na entrega quando a loja não aceita', async () => {
    const { app, bolo, menuRepo } = await montarAppComBolo(30);
    const pedir = (extra: object) =>
      app.inject({
        method: 'POST',
        url: '/v1/orders',
        payload: { empreendedorId: 'emp-1', itens: [{ itemCardapioId: bolo.id, quantidade: 1 }], ...extra },
      });

    expect((await pedir({ formaPagamento: 'DINHEIRO', trocoPara: 20 })).json().codigo).toBe('TROCO_INVALIDO');

    menuRepo.definirRegras('emp-1', { aceitaPagamentoNaEntrega: false });
    expect((await pedir({ formaPagamento: 'CARTAO' })).json().codigo).toBe('PAGAMENTO_NA_ENTREGA_INDISPONIVEL');
    expect((await pedir({ formaPagamento: 'PIX' })).statusCode).toBe(201);
  });

  it('loja com o cadastro incompleto não recebe pedidos (LOJA_EM_MONTAGEM)', async () => {
    const { app, bolo, menuRepo } = await montarAppComBolo();
    menuRepo.definirRegras('emp-1', { cadastroCompleto: false });

    const resposta = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: { empreendedorId: 'emp-1', itens: [{ itemCardapioId: bolo.id, quantidade: 1 }] },
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().codigo).toBe('LOJA_EM_MONTAGEM');
  });

  it('validação em português, um erro por campo', async () => {
    const app = montarApp();

    const resposta = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        itens: [{ itemCardapioId: 'i1', quantidade: 0 }],
        modalidade: 'VOANDO',
        endereco: { uf: 'São Paulo' },
      },
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json()).toMatchObject({
      codigo: 'CARRINHO_INVALIDO',
      detalhes: {
        campos: {
          empreendedorId: 'é obrigatório',
          'itens.0.quantidade': 'deve ser maior que 0',
          modalidade: 'deve ser um destes: RETIRADA, ENTREGA',
          'endereco.uf': expect.stringContaining('2'),
        },
      },
    });
    expect(resposta.body).not.toMatch(/Invalid|expected/);
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

describe('POST /v1/orders para loja inexistente', () => {
  it('retorna 404 LOJA_NAO_ENCONTRADA e não grava pedido', async () => {
    const ordersRepo = criarOrdersRepositoryFake();
    const app = buildApp({
      menuRepo: criarMenuRepositoryFake(),
      ordersRepo,
      pedidoTtlMinutos: 20,
      frontendAllowedOrigin: 'http://localhost:3001',
    });

    const resposta = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: { empreendedorId: 'inventado', itens: [{ itemCardapioId: 'item-1', quantidade: 1 }] },
    });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json().codigo).toBe('LOJA_NAO_ENCONTRADA');
    expect(await ordersRepo.listarExpirados(new Date('2100-01-01'))).toEqual([]);
  });
});

describe('GET /v1/orders/:codigoCurto', () => {
  async function criarPedidoDeBolo() {
    const menuRepo = criarMenuRepositoryFake();
    const ordersRepo = criarOrdersRepositoryFake();
    const bolo = await criarItem(menuRepo, 'emp-1', { nome: 'Bolo', precoBase: 12.5, variacoes: [] });
    const app = buildApp({ menuRepo, ordersRepo, pedidoTtlMinutos: 20, frontendAllowedOrigin: 'http://localhost:3001' });
    const criado = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: { empreendedorId: 'emp-1', itens: [{ itemCardapioId: bolo.id, quantidade: 2 }] },
    });
    const { pedido } = criado.json();
    // Simula o cliente que já confirmou pelo WhatsApp: o telefone não pode vazar.
    await ordersRepo.atualizar(pedido.id, { telefoneCliente: '5581988887777' });
    return { app, codigo: pedido.codigoCurto as string, ordersRepo, pedidoId: pedido.id as string };
  }

  it('devolve status, itens, total e expiração sem o telefone do cliente', async () => {
    const { app, codigo } = await criarPedidoDeBolo();

    const resposta = await app.inject({ method: 'GET', url: `/v1/orders/${codigo.toLowerCase()}` });

    expect(resposta.statusCode).toBe(200);
    const { pedido } = resposta.json();
    expect(pedido).toMatchObject({ codigoCurto: codigo, status: 'AGUARDANDO_CONFIRMACAO', valorTotal: 25 });
    expect(pedido.itens).toEqual([expect.objectContaining({ quantidade: 2, precoUnitario: 12.5 })]);
    expect(pedido.expiraEm).toEqual(expect.any(String));
    expect(resposta.body).not.toContain('5581988887777');
    expect(pedido).not.toHaveProperty('id');
  });

  it('devolve o PIX para copiar só enquanto o pedido aguarda pagamento', async () => {
    const { app, codigo, ordersRepo, pedidoId } = await criarPedidoDeBolo();
    ordersRepo.definirPix(pedidoId, { copiaCola: '00020126...pix', qrCodeBase64: 'data:image/png;base64,ABC' });
    const consultar = async () => (await app.inject({ method: 'GET', url: `/v1/orders/${codigo}` })).json().pedido;

    expect(await consultar()).not.toHaveProperty('pix');

    await ordersRepo.atualizar(pedidoId, { status: 'AGUARDANDO_PAGAMENTO' });
    expect((await consultar()).pix).toEqual({ copiaCola: '00020126...pix', qrCodeBase64: 'data:image/png;base64,ABC' });

    await ordersRepo.atualizar(pedidoId, { status: 'PAGO' });
    expect(await consultar()).not.toHaveProperty('pix');
  });

  it('retorna 404 PEDIDO_NAO_ENCONTRADO para código inexistente ou fora do formato', async () => {
    const { app } = await criarPedidoDeBolo();

    for (const codigo of ['PED-ZZZZ', 'qualquer-coisa', 'xPED-AAAA']) {
      const resposta = await app.inject({ method: 'GET', url: `/v1/orders/${codigo}` });
      expect(resposta.statusCode).toBe(404);
      expect(resposta.json().codigo).toBe('PEDIDO_NAO_ENCONTRADO');
    }
  });
});
