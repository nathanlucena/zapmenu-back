import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { criarMenuRepositoryFake } from '../../menu/__mocks__/menu.repository.fake.js';
import { atualizarItem, garantirItemCompleto } from '../../menu/gestao/gestao.repository.prisma.js';
import { criarMenuRepositoryPrisma } from '../../menu/menu.repository.prisma.js';
import { calcularPrecoUnitario, criarItem } from '../../menu/menu.service.js';
import { criarOrdersRepositoryFake } from '../../orders/__mocks__/orders.repository.fake.js';
import { atualizarAndamento } from '../../orders/application/andamento-pedido.js';
import { confirmarPagamento } from '../../orders/application/confirmar-pagamento.js';
import { cotarEntrega } from '../../orders/application/cotar-entrega.js';
import { criarPedido } from '../../orders/application/criar-pedido.js';
import { decidirPedido } from '../../orders/application/decidir-pedido.js';
import type { RegrasDaLoja } from '../../orders/application/ports/loja-para-pedidos.js';
import { criarMercadoPagoClientFake } from '../../payments/__mocks__/mercado-pago.client.fake.js';
import { criarPaymentsRepositoryFake } from '../../payments/__mocks__/payments.repository.fake.js';
import { processarNotificacaoPagamento } from '../../payments/application/processar-notificacao-pagamento.js';
import { criarIdempotencyRepositoryFake } from '../idempotency/__mocks__/idempotency.repository.fake.js';
import { DomainError } from './domain-error.js';

/** Espera um DomainError com este código (o texto pode mudar; o código é o contrato). */
async function lancaCodigo(acao: () => unknown, codigo: string): Promise<void> {
  let erro: unknown;
  try {
    await acao();
  } catch (capturado) {
    erro = capturado;
  }
  expect(erro).toBeInstanceOf(DomainError);
  expect((erro as DomainError).code).toBe(codigo);
}

const carrinho = { empreendedorId: 'emp-1', itens: [{ itemCardapioId: 'i1', quantidade: 1, precoUnitario: 10 }] };
const DONO = '5511900000001';
const contatos = { telefoneDe: async () => DONO };

describe('códigos de erro sem outro teste', () => {
  it('CODIGO_PEDIDO_INDISPONIVEL: todos os códigos sorteados já existem', async () => {
    const repo = criarOrdersRepositoryFake();
    repo.codigoJaExiste = async () => true;
    await lancaCodigo(() => criarPedido(repo, carrinho, 20), 'CODIGO_PEDIDO_INDISPONIVEL');
  });

  it('ENDERECO_NAO_ENCONTRADO: o mapa não acha o endereço', async () => {
    const regras: RegrasDaLoja = {
      aceitaRetirada: true,
      fazEntrega: true,
      aceitaPagamentoNaEntrega: true,
      cadastroCompleto: true,
      origem: { latitude: -22.9, longitude: -47.06 },
      faixasEntrega: [{ ateKm: 3, taxa: 5 }],
      horarios: [],
    };
    const localizador = { localizar: async () => ({ tipo: 'NAO_ENCONTRADO' as const }) };
    await lancaCodigo(
      () => cotarEntrega(regras, localizador, { cep: '13010000', numero: '1' }),
      'ENDERECO_NAO_ENCONTRADO',
    );
  });

  it('ITEM_INVALIDO: item sem nome ou com preço negativo', async () => {
    await lancaCodigo(
      () => criarItem(criarMenuRepositoryFake(), 'emp-1', { nome: '', precoBase: -1, variacoes: [] }),
      'ITEM_INVALIDO',
    );
  });

  it('VARIACAO_INVALIDA: opção que o item não tem ou variação sem escolha', () => {
    const item = {
      id: 'i1',
      nome: 'Pizza',
      precoBase: 40,
      variacoes: [{ nome: 'Tamanho', opcoes: [{ nome: 'G', precoAdicional: 5 }] }],
    } as Parameters<typeof calcularPrecoUnitario>[0];
    return Promise.all([
      lancaCodigo(() => calcularPrecoUnitario(item, { Borda: 'Catupiry' }), 'VARIACAO_INVALIDA'),
      lancaCodigo(() => calcularPrecoUnitario(item, {}), 'VARIACAO_INVALIDA'),
    ]);
  });

  it('ITEM_INCOMPLETO: item novo sem preço ou sem nome', async () => {
    await lancaCodigo(() => garantirItemCompleto({ nome: 'Coxinha' }), 'ITEM_INCOMPLETO');
    await lancaCodigo(() => garantirItemCompleto({ precoBase: 5 }), 'ITEM_INCOMPLETO');
  });

  it('ITEM_NAO_ENCONTRADO: o item sumiu antes de gravar (gestão e cardápio)', async () => {
    const semItem = { itemCardapio: { updateMany: async () => ({ count: 0 }) } };
    await lancaCodigo(
      () => atualizarItem(semItem as unknown as Parameters<typeof atualizarItem>[0], 'c1', 'i1', {}),
      'ITEM_NAO_ENCONTRADO',
    );
    const repo = criarMenuRepositoryPrisma(semItem as unknown as PrismaClient);
    await lancaCodigo(() => repo.definirAtivo('c1', 'i1', false), 'ITEM_NAO_ENCONTRADO');
  });

  it('PAGAMENTO_NAO_ENCONTRADO: notificação de um pagamento que não é nosso', async () => {
    const deps = {
      gatewayPix: criarMercadoPagoClientFake(),
      paymentsRepo: criarPaymentsRepositoryFake(),
      ordersRepo: criarOrdersRepositoryFake(),
      idempotency: criarIdempotencyRepositoryFake(),
      notificarEmpreendedor: async () => undefined,
    };
    await lancaCodigo(
      () => processarNotificacaoPagamento(deps, { eventoId: 'e1', idTransacaoExterno: 'ORD-DE-OUTRO' }),
      'PAGAMENTO_NAO_ENCONTRADO',
    );
  });
});

describe('códigos das respostas da loja', () => {
  async function pedidoComALoja(agora = new Date('2026-10-21T12:00:00Z')) {
    const ordersRepo = criarOrdersRepositoryFake();
    const pedido = await criarPedido(ordersRepo, carrinho, 20, agora);
    return {
      ordersRepo,
      pedido: await ordersRepo.atualizar(pedido.id, {
        status: 'AGUARDANDO_ACEITE',
        expiraEm: new Date(agora.getTime() + 15 * 60_000),
      }),
    };
  }

  it('PEDIDO_DE_OUTRA_LOJA: quem decide não é o dono', async () => {
    const { ordersRepo, pedido } = await pedidoComALoja();
    await lancaCodigo(
      () => decidirPedido({ ordersRepo, contatos }, pedido, 'ACEITAR', '5511911112222'),
      'PEDIDO_DE_OUTRA_LOJA',
    );
  });

  it('PEDIDO_EXPIRADO: a loja respondeu depois do prazo', async () => {
    const { ordersRepo, pedido } = await pedidoComALoja();
    await lancaCodigo(
      () => decidirPedido({ ordersRepo, contatos }, pedido, 'ACEITAR', DONO, new Date('2026-10-21T12:30:00Z')),
      'PEDIDO_EXPIRADO',
    );
  });

  it('PEDIDO_JA_DECIDIDO: segunda resposta para o mesmo pedido', async () => {
    const { ordersRepo, pedido } = await pedidoComALoja();
    const agora = new Date('2026-10-21T12:01:00Z');
    const aceito = await decidirPedido({ ordersRepo, contatos }, pedido, 'ACEITAR', DONO, agora);
    await lancaCodigo(
      () => decidirPedido({ ordersRepo, contatos }, aceito, 'RECUSAR', DONO, agora),
      'PEDIDO_JA_DECIDIDO',
    );
  });

  it('ANDAMENTO_REPETIDO e TRANSICAO_INVALIDA no andamento', async () => {
    const { ordersRepo, pedido } = await pedidoComALoja();
    await lancaCodigo(
      () => atualizarAndamento({ ordersRepo, contatos }, pedido, 'A_CAMINHO', DONO),
      'TRANSICAO_INVALIDA',
    );

    const pago = await ordersRepo.atualizar(pedido.id, { status: 'PAGO' });
    const pronto = await atualizarAndamento({ ordersRepo, contatos }, pago, 'A_CAMINHO', DONO);
    await lancaCodigo(
      () => atualizarAndamento({ ordersRepo, contatos }, pronto, 'A_CAMINHO', DONO),
      'ANDAMENTO_REPETIDO',
    );
  });

  it('TRANSICAO_INVALIDA ao marcar como pago um pedido que não aguarda pagamento', async () => {
    const { ordersRepo, pedido } = await pedidoComALoja();
    await lancaCodigo(() => confirmarPagamento(ordersRepo, pedido.id, pedido), 'TRANSICAO_INVALIDA');
  });
});

/** Todos os .ts do diretório, recursivamente. */
function arquivos(diretorio: string): string[] {
  return readdirSync(diretorio).flatMap((nome) => {
    const caminho = join(diretorio, nome);
    return statSync(caminho).isDirectory() ? arquivos(caminho) : caminho.endsWith('.ts') ? [caminho] : [];
  });
}

const TIPOS = new Set(['REGRA_VIOLADA', 'NAO_ENCONTRADO', 'CONFLITO', 'INDISPONIVEL']);

describe('guarda: todo código de erro tem teste', () => {
  it('cada código usado em new DomainError(...) aparece entre aspas em algum teste', () => {
    const todos = [...arquivos('src'), ...arquivos('test')];
    const testes = todos
      .filter((arquivo) => arquivo.includes('.test.'))
      .map((arquivo) => readFileSync(arquivo, 'utf8'));
    const codigos = new Set<string>();
    for (const arquivo of todos.filter((caminho) => !caminho.includes('.test.') && !caminho.includes('__mocks__'))) {
      const fonte = readFileSync(arquivo, 'utf8');
      for (const chamada of fonte.matchAll(/new DomainError\(([\s\S]*?)\);/g)) {
        // Todo literal em MAIÚSCULAS da chamada, menos os tipos (REGRA_VIOLADA, CONFLITO…).
        for (const [, codigo] of chamada[1]!.matchAll(/'([A-Z][A-Z_]{2,})'/g)) {
          if (!TIPOS.has(codigo!)) codigos.add(codigo!);
        }
      }
    }

    const semTeste = [...codigos].filter((codigo) => !testes.some((teste) => teste.includes(`'${codigo}'`)));

    expect(codigos.size).toBeGreaterThan(25);
    expect(semTeste).toEqual([]);
  });
});
