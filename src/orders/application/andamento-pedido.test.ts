import { describe, expect, it } from 'vitest';
import { criarOrdersRepositoryFake } from '../__mocks__/orders.repository.fake.js';
import { extrairAndamentoPedido } from '../domain/pedido.js';
import { concluirPedidosAntigos, pedirAndamentoDaLoja } from './andamento-pedido.js';
import { criarPedido } from './criar-pedido.js';

const carrinho = { empreendedorId: 'emp-1', itens: [{ itemCardapioId: 'i1', quantidade: 1, precoUnitario: 10 }] };

describe('extrairAndamentoPedido', () => {
  it('lê "saiu"/"pronto" como a caminho e "entregue"/"retirado" como concluído', () => {
    expect(extrairAndamentoPedido('saiu PED-7KQ2')).toEqual({ andamento: 'A_CAMINHO', codigoCurto: 'PED-7KQ2' });
    expect(extrairAndamentoPedido('Pronto o ped-7kq2')).toEqual({ andamento: 'A_CAMINHO', codigoCurto: 'PED-7KQ2' });
    expect(extrairAndamentoPedido('entregue PED-7KQ2')).toEqual({ andamento: 'CONCLUIDO', codigoCurto: 'PED-7KQ2' });
    expect(extrairAndamentoPedido('quero o PED-7KQ2')).toBeNull();
  });
});

describe('pedirAndamentoDaLoja', () => {
  it('na retirada pergunta "Pronto para retirar" / "Retirado" e guarda a enquete no pedido', async () => {
    const repo = criarOrdersRepositoryFake();
    const pedido = await criarPedido(repo, carrinho, 20, new Date(), { modalidade: 'RETIRADA' });
    const enquetes: { pergunta: string; opcoes: string[] }[] = [];

    await pedirAndamentoDaLoja(
      {
        ordersRepo: repo,
        contatos: { telefoneDe: async () => '5511900000001' },
        mensageiro: {
          enviarTexto: async () => undefined,
          enviarEnquete: async (_telefone, pergunta, opcoes) => {
            enquetes.push({ pergunta, opcoes });
            return 'enquete-9';
          },
        },
      },
      pedido,
    );

    expect(enquetes).toEqual([{ pergunta: `Andamento do pedido ${pedido.codigoCurto}`, opcoes: ['Pronto para retirar', 'Retirado'] }]);
    expect((await repo.buscarPorEnquete('enquete-9'))?.id).toBe(pedido.id);
  });
});

describe('concluirPedidosAntigos', () => {
  it('conclui só os pedidos em andamento mais velhos que o limite', async () => {
    const repo = criarOrdersRepositoryFake();
    const agora = new Date('2026-10-21T12:00:00Z');
    const velho = await criarPedido(repo, carrinho, 20, new Date('2026-10-20T20:00:00Z'));
    const novo = await criarPedido(repo, carrinho, 20, new Date('2026-10-21T11:00:00Z'));
    const naoPago = await criarPedido(repo, carrinho, 20, new Date('2026-10-20T20:00:00Z'));
    await repo.atualizar(velho.id, { status: 'SAIU_PARA_ENTREGA' });
    await repo.atualizar(novo.id, { status: 'PAGO' });

    const concluidos = await concluirPedidosAntigos(repo, 12, agora);

    expect(concluidos.map((p) => p.id)).toEqual([velho.id]);
    expect((await repo.buscarPorId(novo.id))?.status).toBe('PAGO');
    expect((await repo.buscarPorId(naoPago.id))?.status).toBe('AGUARDANDO_CONFIRMACAO');
  });
});
