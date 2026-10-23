import { describe, expect, it } from 'vitest';
import { criarPaymentsRepositoryFake } from '../payments/__mocks__/payments.repository.fake.js';
import { aplicarStatusPagamento } from '../payments/application/aplicar-status-pagamento.js';
import { criarOrdersRepositoryFake, type OrdersRepositoryFake } from './__mocks__/orders.repository.fake.js';
import { montarAvisoPedidoPago } from './application/avisar-pedido-pago.js';
import { confirmarPagamento } from './application/confirmar-pagamento.js';
import { criarPedido } from './application/criar-pedido.js';
import { decidirPedido } from './application/decidir-pedido.js';
import { podeTransicionar, STATUS_DE_VENDA, type FormaPagamento, type Pedido, type StatusPedido } from './domain/pedido.js';

const DONO = '5511900000001';
const contatos = { telefoneDe: async () => DONO };
const AGORA = new Date('2026-10-23T12:00:00Z');

/** Pedido de 2 camisetas M azul (SKU) e 1 bolo (sem SKU), já no status pedido. */
async function pedidoNoStatus(
  ordersRepo: OrdersRepositoryFake,
  status: StatusPedido,
  formaPagamento: FormaPagamento = 'PIX',
): Promise<Pedido> {
  const criado = await criarPedido(
    ordersRepo,
    {
      empreendedorId: 'emp-1',
      itens: [
        {
          itemCardapioId: 'camiseta',
          nome: 'Camiseta',
          skuId: 'sku-m-azul',
          quantidade: 2,
          precoUnitario: 60,
          variacaoEscolhida: { Tamanho: 'M', Cor: 'Azul' },
        },
        { itemCardapioId: 'bolo', quantidade: 1, precoUnitario: 20 },
      ],
    },
    20,
    AGORA,
    { formaPagamento },
  );
  return ordersRepo.atualizar(criado.id, { status });
}

describe('baixa de estoque no PIX pago', () => {
  it('marca como pago e baixa o estoque do SKU', async () => {
    const ordersRepo = criarOrdersRepositoryFake();
    ordersRepo.definirEstoque('sku-m-azul', 5);
    const pedido = await pedidoNoStatus(ordersRepo, 'AGUARDANDO_PAGAMENTO');

    const pago = await confirmarPagamento(ordersRepo, pedido.id, pedido, AGORA);

    expect(pago?.status).toBe('PAGO');
    expect(pago?.faltaEstoque).toBeUndefined();
    expect(ordersRepo.estoqueDe('sku-m-azul')).toBe(3);
  });

  it('a segunda notificação do mesmo pagamento não baixa de novo', async () => {
    const ordersRepo = criarOrdersRepositoryFake();
    ordersRepo.definirEstoque('sku-m-azul', 5);
    const pedido = await pedidoNoStatus(ordersRepo, 'AGUARDANDO_PAGAMENTO');

    await confirmarPagamento(ordersRepo, pedido.id, pedido, AGORA);
    // Webhook e poller leram o pedido antes de qualquer um gravar.
    const repetido = await confirmarPagamento(ordersRepo, pedido.id, pedido, AGORA);

    expect(repetido).toBeNull();
    expect(ordersRepo.estoqueDe('sku-m-azul')).toBe(3);
  });

  it('webhook e poller juntos avisam a loja uma vez só', async () => {
    const ordersRepo = criarOrdersRepositoryFake();
    ordersRepo.definirEstoque('sku-m-azul', 5);
    const pedido = await pedidoNoStatus(ordersRepo, 'AGUARDANDO_PAGAMENTO');
    const paymentsRepo = criarPaymentsRepositoryFake();
    const pagamento = await paymentsRepo.criar({
      pedidoId: pedido.id,
      provedor: 'mercado_pago',
      idTransacaoExterno: 'mp-1',
      status: 'PENDENTE',
      criadoEm: AGORA,
    });
    const avisos: Pedido[] = [];
    const deps = { paymentsRepo, ordersRepo, notificarEmpreendedor: async (pago: Pedido) => void avisos.push(pago) };

    await Promise.all([
      aplicarStatusPagamento(deps, pagamento, 'APROVADO', AGORA),
      aplicarStatusPagamento(deps, pagamento, 'APROVADO', AGORA),
    ]);

    expect(avisos).toHaveLength(1);
    expect(ordersRepo.estoqueDe('sku-m-azul')).toBe(3);
  });

  it('sem estoque suficiente, fica pago, zera o estoque e avisa a loja da falta', async () => {
    const ordersRepo = criarOrdersRepositoryFake();
    ordersRepo.definirEstoque('sku-m-azul', 1);
    const pedido = await pedidoNoStatus(ordersRepo, 'AGUARDANDO_PAGAMENTO');

    const pago = await confirmarPagamento(ordersRepo, pedido.id, pedido, AGORA);

    expect(pago?.status).toBe('PAGO');
    expect(pago?.faltaEstoque).toEqual([{ skuId: 'sku-m-azul', quantidade: 2, disponivel: 1 }]);
    expect(ordersRepo.estoqueDe('sku-m-azul')).toBe(0);
    expect(montarAvisoPedidoPago(pago!)).toContain(
      '⚠️ Pago, mas falta estoque de Camiseta (Tamanho: M, Cor: Azul): pediu 2, havia 1.',
    );
  });
});

describe('baixa de estoque no pagamento na entrega', () => {
  it('aceitar o pedido confirma e baixa o estoque', async () => {
    const ordersRepo = criarOrdersRepositoryFake();
    ordersRepo.definirEstoque('sku-m-azul', 2);
    const pedido = await pedidoNoStatus(ordersRepo, 'AGUARDANDO_ACEITE', 'DINHEIRO');

    const aceito = await decidirPedido({ ordersRepo, contatos }, pedido, 'ACEITAR', DONO, AGORA);

    expect(aceito.status).toBe('CONFIRMADO');
    expect(ordersRepo.estoqueDe('sku-m-azul')).toBe(0);
  });

  it('sem estoque, não aceita e não mexe em nada', async () => {
    const ordersRepo = criarOrdersRepositoryFake();
    ordersRepo.definirEstoque('sku-m-azul', 1);
    const pedido = await pedidoNoStatus(ordersRepo, 'AGUARDANDO_ACEITE', 'CARTAO');

    const aceite = decidirPedido({ ordersRepo, contatos }, pedido, 'ACEITAR', DONO, AGORA);

    await expect(aceite).rejects.toMatchObject({
      code: 'SEM_ESTOQUE',
      message: `Não dá para aceitar o pedido ${pedido.codigoCurto}: falta estoque de Camiseta (Tamanho: M, Cor: Azul): pediu 2, havia 1. Recuse o pedido ou ajuste o estoque.`,
    });
    expect((await ordersRepo.buscarPorId(pedido.id))?.status).toBe('AGUARDANDO_ACEITE');
    expect(ordersRepo.estoqueDe('sku-m-azul')).toBe(1);
  });

  it('pedido com PIX aceito só vai para pagamento, sem baixar', async () => {
    const ordersRepo = criarOrdersRepositoryFake();
    ordersRepo.definirEstoque('sku-m-azul', 2);
    const pedido = await pedidoNoStatus(ordersRepo, 'AGUARDANDO_ACEITE');

    const aceito = await decidirPedido({ ordersRepo, contatos }, pedido, 'ACEITAR', DONO, AGORA);

    expect(aceito.status).toBe('AGUARDANDO_PAGAMENTO');
    expect(ordersRepo.estoqueDe('sku-m-azul')).toBe(2);
  });
});

describe('devolução de estoque', () => {
  it('não é necessária: pedido vendido nunca vira expirado, recusado ou cancelado', () => {
    for (const vendido of STATUS_DE_VENDA) {
      for (const desfeito of ['EXPIRADO', 'RECUSADO', 'CANCELADO'] as const) {
        expect(podeTransicionar(vendido, desfeito), `${vendido} → ${desfeito}`).toBe(false);
      }
    }
  });
});
