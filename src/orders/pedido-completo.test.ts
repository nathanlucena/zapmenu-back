import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../http/app.js';
import { criarEnderecoFake, type EnderecoFake } from '../menu/endereco/__mocks__/endereco.fake.js';
import { criarMenuRepositoryFake } from '../menu/__mocks__/menu.repository.fake.js';
import { criarItem } from '../menu/menu.service.js';
import { criarOrdersRepositoryFake } from './__mocks__/orders.repository.fake.js';
import type { RegrasDaLoja } from './application/ports/loja-para-pedidos.js';

// A cerca de 1 km da Rua da Aurora, 123 (endereço do fake de geocodificação).
const LOJA_NO_RECIFE = { latitude: -8.0631, longitude: -34.8711 };
const ENDERECO_CLIENTE = { cep: '50050-000', numero: '123', complemento: 'apto 201' };

async function montar(regras: Partial<RegrasDaLoja> = {}, opcoes: { semMapa?: boolean } = {}) {
  const menuRepo = criarMenuRepositoryFake();
  const ordersRepo = criarOrdersRepositoryFake();
  const endereco: EnderecoFake = criarEnderecoFake();
  const bolo = await criarItem(menuRepo, 'emp-1', { nome: 'Bolo', precoBase: 20, variacoes: [] });
  menuRepo.definirRegras('emp-1', regras);
  const app = buildApp({
    menuRepo,
    ordersRepo,
    pedidoTtlMinutos: 20,
    frontendAllowedOrigin: 'http://localhost:3001',
    endereco: opcoes.semMapa ? undefined : endereco,
  });
  const pedir = (extra: Record<string, unknown> = {}, quantidade = 2) =>
    app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: { empreendedorId: 'emp-1', itens: [{ itemCardapioId: bolo.id, quantidade }], ...extra },
    });
  return { app, pedir, endereco, ordersRepo };
}

const COM_ENTREGA: Partial<RegrasDaLoja> = {
  fazEntrega: true,
  origem: LOJA_NO_RECIFE,
  faixasEntrega: [
    { ateKm: 2, taxa: 5 },
    { ateKm: 5, taxa: 8 },
  ],
};

afterEach(() => {
  vi.useRealTimers();
});

describe('pedido com retirada', () => {
  it('é o padrão e grava nome e observação sem taxa', async () => {
    const { pedir } = await montar();

    const resposta = await pedir({ nomeCliente: 'Ana', observacao: 'Sem açúcar' });

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json().pedido).toMatchObject({
      modalidade: 'RETIRADA',
      taxaEntrega: 0,
      valorTotal: 40,
      nomeCliente: 'Ana',
      observacao: 'Sem açúcar',
    });
  });

  it('guarda a observação de cada item e a devolve na consulta do pedido', async () => {
    const { app } = await montar();
    const cardapio = (await app.inject({ method: 'GET', url: '/v1/menu/emp-1' })).json();
    const boloId = cardapio.itens[0].id;

    const criado = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        empreendedorId: 'emp-1',
        itens: [
          { itemCardapioId: boloId, quantidade: 1, observacao: '  Bem assado  ' },
          { itemCardapioId: boloId, quantidade: 1 },
        ],
      },
    });
    expect(criado.statusCode).toBe(201);

    const consulta = await app.inject({ method: 'GET', url: `/v1/orders/${criado.json().pedido.codigoCurto}` });
    expect(consulta.json().pedido.itens.map((item: { observacao?: string }) => item.observacao)).toEqual([
      'Bem assado',
      undefined,
    ]);
  });

  it('recusa observação de item com mais de 140 caracteres', async () => {
    const { app } = await montar();
    const cardapio = (await app.inject({ method: 'GET', url: '/v1/menu/emp-1' })).json();

    const resposta = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        empreendedorId: 'emp-1',
        itens: [{ itemCardapioId: cardapio.itens[0].id, quantidade: 1, observacao: 'x'.repeat(141) }],
      },
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().codigo).toBe('CARRINHO_INVALIDO');
  });

  it('é recusada quando a loja só entrega', async () => {
    const { pedir } = await montar({ aceitaRetirada: false });

    const resposta = await pedir({ modalidade: 'RETIRADA' });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().codigo).toBe('RETIRADA_INDISPONIVEL');
  });
});

describe('pedido com entrega', () => {
  it('soma a taxa da faixa ao total, igual à cotação mostrada no app', async () => {
    const { app, pedir } = await montar(COM_ENTREGA);

    const cotacao = await app.inject({
      method: 'POST',
      url: '/v1/entrega/cotacao',
      payload: { empreendedorId: 'emp-1', endereco: ENDERECO_CLIENTE },
    });
    const resposta = await pedir({ modalidade: 'ENTREGA', endereco: ENDERECO_CLIENTE });

    expect(cotacao.statusCode).toBe(200);
    expect(cotacao.json().entrega).toMatchObject({ taxa: 5, avisos: [] });
    expect(cotacao.json().entrega.distanciaKm).toBeLessThan(2);
    expect(resposta.statusCode).toBe(201);
    const { pedido } = resposta.json();
    expect(pedido).toMatchObject({ modalidade: 'ENTREGA', taxaEntrega: 5, valorTotal: 45 });
    expect(pedido.entrega).toMatchObject({ numero: '123', complemento: 'apto 201', cep: '50050000' });
    expect(pedido.entrega.enderecoFormatado).toContain('(apto 201)');
  });

  it('a consulta pública do pedido mostra a taxa, mas não o endereço do cliente', async () => {
    const { app, pedir } = await montar(COM_ENTREGA);
    const { pedido } = (await pedir({ modalidade: 'ENTREGA', endereco: ENDERECO_CLIENTE })).json();

    const consulta = await app.inject({ method: 'GET', url: `/v1/orders/${pedido.codigoCurto}` });

    expect(consulta.json().pedido).toMatchObject({ modalidade: 'ENTREGA', taxaEntrega: 5, valorTotal: 45 });
    expect(consulta.body).not.toContain('Aurora');
  });

  it('recusa endereço fora da maior faixa', async () => {
    const { pedir, ordersRepo } = await montar({ ...COM_ENTREGA, faixasEntrega: [{ ateKm: 0.5, taxa: 3 }] });

    const resposta = await pedir({ modalidade: 'ENTREGA', endereco: ENDERECO_CLIENTE });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().codigo).toBe('FORA_DA_AREA');
    expect(await ordersRepo.buscarResumoPublico('PED-0000')).toBeNull();
  });

  it('não consulta o mapa quando a loja não entrega', async () => {
    const { pedir, endereco } = await montar({ fazEntrega: false });

    const resposta = await pedir({ modalidade: 'ENTREGA', endereco: ENDERECO_CLIENTE });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().codigo).toBe('ENTREGA_INDISPONIVEL');
    expect(endereco.buscasGeo).toEqual([]);
  });

  it('exige o endereço', async () => {
    const { pedir } = await montar(COM_ENTREGA);

    const resposta = await pedir({ modalidade: 'ENTREGA' });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().codigo).toBe('CARRINHO_INVALIDO');
  });

  it('explica o que falta no endereço', async () => {
    const { pedir } = await montar(COM_ENTREGA);

    const resposta = await pedir({ modalidade: 'ENTREGA', endereco: { cep: '50050-000' } });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json()).toMatchObject({ codigo: 'ENDERECO_INVALIDO', erro: expect.stringContaining('número') });
  });

  it('responde 503 quando o mapa está fora do ar ou não configurado', async () => {
    const foraDoAr = await montar(COM_ENTREGA);
    foraDoAr.endereco.geo = 'erro';
    const semMapa = await montar(COM_ENTREGA, { semMapa: true });

    const respostas = [
      await foraDoAr.pedir({ modalidade: 'ENTREGA', endereco: ENDERECO_CLIENTE }),
      await semMapa.pedir({ modalidade: 'ENTREGA', endereco: ENDERECO_CLIENTE }),
    ];

    expect(respostas.map((resposta) => [resposta.statusCode, resposta.json().codigo])).toEqual([
      [503, 'ENDERECO_INDISPONIVEL'],
      [503, 'ENTREGA_INDISPONIVEL'],
    ]);
  });
});

describe('regras da loja', () => {
  it('recusa pedido abaixo do mínimo, sem contar a taxa de entrega', async () => {
    const { pedir } = await montar({ ...COM_ENTREGA, pedidoMinimo: 45 });

    // 40 de itens + 5 de entrega = 45, mas o mínimo vale só para os itens.
    const resposta = await pedir({ modalidade: 'ENTREGA', endereco: ENDERECO_CLIENTE });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().codigo).toBe('PEDIDO_ABAIXO_MINIMO');
  });

  it('recusa pedido com a loja fechada', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Segunda, 10h em São Paulo.
    vi.setSystemTime(new Date('2026-10-19T10:00:00-03:00'));
    const { pedir } = await montar({ horarios: [{ dia: 'seg', abre: '18:00', fecha: '23:00' }] });

    const resposta = await pedir();

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().codigo).toBe('LOJA_FECHADA');
  });
});

describe('pedido com envio pelos Correios', () => {
  async function montarComEnvio(envio: RegrasDaLoja['envio']) {
    return montar({ envio });
  }

  it('soma o frete fixo da UF no total e guarda o endereço do CEP', async () => {
    const { pedir, endereco } = await montarComEnvio({ padrao: 25, porUf: { PE: 12 } });

    const resposta = await pedir({ modalidade: 'ENVIO', endereco: ENDERECO_CLIENTE });

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json().pedido).toMatchObject({
      modalidade: 'ENVIO',
      taxaEntrega: 12,
      valorTotal: 52,
      entrega: { uf: 'PE', cidade: 'Recife', enderecoFormatado: 'Rua da Aurora, 123 - apto 201 - Boa Vista, Recife - PE, 50050-000' },
    });
    expect(endereco.buscasGeo).toEqual([]);
  });

  it('cotação do envio mostra o frete antes do pedido', async () => {
    const { app } = await montarComEnvio({ padrao: 25, porUf: {} });

    const resposta = await app.inject({
      method: 'POST',
      url: '/v1/envio/cotacao',
      payload: { empreendedorId: 'emp-1', endereco: ENDERECO_CLIENTE },
    });

    expect(resposta.json()).toEqual({
      envio: { enderecoFormatado: 'Rua da Aurora, 123 - apto 201 - Boa Vista, Recife - PE, 50050-000', uf: 'PE', frete: 25 },
    });
  });

  it('envio só com PIX e só em loja que envia', async () => {
    const { pedir } = await montarComEnvio({ padrao: 25, porUf: {} });
    const semEnvio = await montar();

    expect((await pedir({ modalidade: 'ENVIO', endereco: ENDERECO_CLIENTE, formaPagamento: 'DINHEIRO' })).json().erro).toBe(
      'No envio pelos Correios o pagamento é só por PIX.',
    );
    expect((await semEnvio.pedir({ modalidade: 'ENVIO', endereco: ENDERECO_CLIENTE })).json().codigo).toBe('ENVIO_INDISPONIVEL');
  });
});
