import { describe, expect, it } from 'vitest';
import { criarMenuRepositoryFake } from '../__mocks__/menu.repository.fake.js';
import { criarOrdersRepositoryFake } from '../../orders/__mocks__/orders.repository.fake.js';
import { buildApp } from '../../http/app.js';
import { rascunhoVazio } from '../conversation/conversation-state.types.js';
import { LOJA_SALVA_VAZIA } from './__mocks__/gestao.repository.fake.js';
import { criarPreviasRepositoryFake } from './__mocks__/previas.repository.fake.js';
import type { SnapshotCardapio } from './gestao.repository.js';
import { montarPrevia } from './previa.js';

const snapshot: SnapshotCardapio = {
  cardapioId: 'c1',
  categorias: [{ id: 'cat1', nome: 'Pizzas' }],
  itens: [
    {
      id: 'i1',
      nome: 'Mussarela',
      precoBase: 40,
      ativo: true,
      temFoto: true,
      imagemUrl: 'data:image/png;base64,MUSSA',
      categoriaId: 'cat1',
      categoriaNome: 'Pizzas',
      variacoes: [],
    },
  ],
  loja: { nome: 'Pizzaria do Zé', corDestaque: '#C2410C' },
  lojaSalva: { ...LOJA_SALVA_VAZIA, existe: true, temLogo: true, logoUrl: 'data:image/png;base64,LOGO' },
};

const BORDAS = [{ nome: 'Borda', opcoes: [{ nome: 'Catupiry', precoAdicional: 8 }] }];

describe('montarPrevia', () => {
  it('item novo com foto e variações, com os valores finais', () => {
    const rascunho = rascunhoVazio();
    rascunho.novosItens.push({
      ref: 'n1',
      nome: 'Calabresa',
      precoBase: 50,
      imagemUrl: 'data:image/jpeg;base64,FOTO',
      categoria: 'Pizzas',
      variacoes: BORDAS,
    });

    expect(montarPrevia(rascunho, snapshot)).toEqual({
      loja: {
        nome: 'Pizzaria do Zé',
        corDestaque: '#C2410C',
        logoUrl: 'data:image/png;base64,LOGO',
        alterada: false,
      },
      itens: [
        {
          nome: 'Calabresa',
          precoBase: 50,
          imagemUrl: 'data:image/jpeg;base64,FOTO',
          categoria: 'Pizzas',
          variacoes: BORDAS,
          marca: 'NOVO',
        },
      ],
      itensOcultos: 0,
    });
  });

  it('com muitos itens guarda 4 (novos primeiro) e conta o resto', () => {
    const rascunho = rascunhoVazio();
    for (const nome of ['A', 'B', 'C', 'D', 'E']) rascunho.novosItens.push({ ref: nome, nome, precoBase: 10 });
    rascunho.edicoes.push({ itemId: 'i1', precoBase: 45 });

    const previa = montarPrevia(rascunho, snapshot)!;

    expect(previa.itens.map((item) => item.nome)).toEqual(['A', 'B', 'C', 'D']);
    expect(previa.itensOcultos).toBe(2);
  });

  it('item editado aparece com a foto e os dados atuais por baixo da edição', () => {
    const rascunho = rascunhoVazio();
    rascunho.edicoes.push({ itemId: 'i1', precoBase: 45 });

    expect(montarPrevia(rascunho, snapshot)?.itens).toEqual([
      expect.objectContaining({
        nome: 'Mussarela',
        precoBase: 45,
        imagemUrl: 'data:image/png;base64,MUSSA',
        marca: 'ALTERADO',
      }),
    ]);
  });

  it('mudança da loja mostra o cabeçalho com a nova cor', () => {
    const rascunho = rascunhoVazio();
    rascunho.loja = { corDestaque: '#1D4ED8' };

    expect(montarPrevia(rascunho, snapshot)?.loja).toMatchObject({ corDestaque: '#1D4ED8', alterada: true });
  });

  it('só pausas, remoções ou troca de categoria não geram prévia', () => {
    const rascunho = rascunhoVazio();
    rascunho.status.push({ itemId: 'i1', acao: 'PAUSAR' });
    rascunho.edicoes.push({ itemId: 'i1', categoria: null });
    rascunho.loja = { pedidoMinimo: 30 };

    expect(montarPrevia(rascunho, snapshot)).toBeNull();
  });
});

describe('GET /v1/previas/:id', () => {
  it('devolve a prévia guardada e 404 PREVIA_NAO_ENCONTRADA quando venceu ou não existe', async () => {
    const previas = criarPreviasRepositoryFake();
    const app = buildApp({
      menuRepo: criarMenuRepositoryFake(),
      ordersRepo: criarOrdersRepositoryFake(),
      pedidoTtlMinutos: 20,
      frontendAllowedOrigin: 'http://localhost:3001',
      previas,
    });
    const id = await previas.guardar({ loja: { alterada: false }, itens: [], itensOcultos: 0 }, 60_000);
    const vencida = await previas.guardar({ loja: { alterada: false }, itens: [], itensOcultos: 0 }, -1);

    expect((await app.inject({ method: 'GET', url: `/v1/previas/${id}` })).json()).toEqual({
      previa: { loja: { alterada: false }, itens: [], itensOcultos: 0 },
    });
    for (const outro of [vencida, 'nao-existe']) {
      const resposta = await app.inject({ method: 'GET', url: `/v1/previas/${outro}` });
      expect(resposta.statusCode).toBe(404);
      expect(resposta.json().codigo).toBe('PREVIA_NAO_ENCONTRADA');
    }
  });
});
