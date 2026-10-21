import { describe, expect, it } from 'vitest';
import { criarOrdersRepositoryFake } from './__mocks__/orders.repository.fake.js';
import { calcularValorTotal, estaExpirado, extrairCodigoPedido, podeTransicionar, validarCarrinho } from './domain/pedido.js';
import { confirmarPagamento } from './application/confirmar-pagamento.js';
import { confirmarRecebimentoCliente } from './application/confirmar-recebimento-cliente.js';
import { criarPedido } from './application/criar-pedido.js';
import { expirarPedidosPendentes } from './application/expirar-pedidos-pendentes.js';
import type { CarrinhoInput } from './domain/pedido.js';

function carrinhoValido(overrides: Partial<CarrinhoInput> = {}): CarrinhoInput {
  return {
    empreendedorId: 'emp-1',
    itens: [{ itemCardapioId: 'item-1', quantidade: 2, precoUnitario: 10 }],
    ...overrides,
  };
}

describe('calcularValorTotal', () => {
  it('soma quantidade x preço unitário de todos os itens', () => {
    const total = calcularValorTotal([
      { itemCardapioId: 'a', quantidade: 2, precoUnitario: 10 },
      { itemCardapioId: 'b', quantidade: 1, precoUnitario: 5 },
    ]);
    expect(total).toBe(25);
  });
});

describe('validarCarrinho', () => {
  it('rejeita carrinho vazio', () => {
    expect(validarCarrinho(carrinhoValido({ itens: [] }))).toContain(
      'O carrinho precisa de ao menos um item.',
    );
  });

  it('rejeita quantidade zero ou negativa', () => {
    const erros = validarCarrinho(
      carrinhoValido({ itens: [{ itemCardapioId: 'x', quantidade: 0, precoUnitario: 10 }] }),
    );
    expect(erros).toContain('Quantidade inválida para o item x.');
  });
});

describe('podeTransicionar', () => {
  it('permite AGUARDANDO_CONFIRMACAO -> AGUARDANDO_PAGAMENTO', () => {
    expect(podeTransicionar('AGUARDANDO_CONFIRMACAO', 'AGUARDANDO_PAGAMENTO')).toBe(true);
  });

  it('não permite transição a partir de estado terminal PAGO', () => {
    expect(podeTransicionar('PAGO', 'CANCELADO')).toBe(false);
  });

  it('não permite pular de AGUARDANDO_CONFIRMACAO direto para PAGO', () => {
    expect(podeTransicionar('AGUARDANDO_CONFIRMACAO', 'PAGO')).toBe(false);
  });
});

describe('extrairCodigoPedido', () => {
  it('extrai o código de dentro de uma frase, ignorando maiúsculas/minúsculas', () => {
    expect(extrairCodigoPedido('Confirmar pedido ped-a8x3')).toBe('PED-A8X3');
  });

  it('retorna null quando não há código na mensagem', () => {
    expect(extrairCodigoPedido('oi, quero confirmar meu pedido')).toBeNull();
  });
});

describe('estaExpirado', () => {
  it('considera expirado quando passou do TTL e ainda está aguardando confirmação', () => {
    const agora = new Date('2026-01-01T10:00:00Z');
    const pedido = { status: 'AGUARDANDO_CONFIRMACAO' as const, expiraEm: new Date('2026-01-01T09:59:00Z') };
    expect(estaExpirado(pedido, agora)).toBe(true);
  });

  it('não considera expirado se já saiu de AGUARDANDO_CONFIRMACAO', () => {
    const agora = new Date('2026-01-01T10:00:00Z');
    const pedido = { status: 'AGUARDANDO_PAGAMENTO' as const, expiraEm: new Date('2026-01-01T09:59:00Z') };
    expect(estaExpirado(pedido, agora)).toBe(false);
  });
});

describe('criarPedido', () => {
  it('cria pedido com status inicial, código curto e expiraEm calculado pelo TTL', async () => {
    const repositorio = criarOrdersRepositoryFake();
    const agora = new Date('2026-01-01T10:00:00Z');

    const pedido = await criarPedido(repositorio, carrinhoValido(), 20, agora);

    expect(pedido.status).toBe('AGUARDANDO_CONFIRMACAO');
    expect(pedido.codigoCurto).toMatch(/^PED-[A-Z0-9]{4}$/);
    expect(pedido.valorTotal).toBe(20);
    expect(pedido.expiraEm.getTime()).toBe(agora.getTime() + 20 * 60_000);
  });

  it('lança DomainError para carrinho inválido', async () => {
    const repositorio = criarOrdersRepositoryFake();
    await expect(criarPedido(repositorio, carrinhoValido({ itens: [] }), 20)).rejects.toThrow(
      'O carrinho precisa de ao menos um item.',
    );
  });
});

describe('confirmarRecebimentoCliente', () => {
  it('transiciona pedido para AGUARDANDO_PAGAMENTO e associa telefone do cliente', async () => {
    const repositorio = criarOrdersRepositoryFake();
    const criado = await criarPedido(repositorio, carrinhoValido(), 20, new Date('2026-01-01T10:00:00Z'));

    const confirmado = await confirmarRecebimentoCliente(
      repositorio,
      criado.codigoCurto,
      '5511999998888',
      new Date('2026-01-01T10:05:00Z'),
    );

    expect(confirmado.status).toBe('AGUARDANDO_PAGAMENTO');
    expect(confirmado.telefoneCliente).toBe('5511999998888');
  });

  it('lança DomainError se o pedido não existe', async () => {
    const repositorio = criarOrdersRepositoryFake();
    await expect(
      confirmarRecebimentoCliente(repositorio, 'PED-ZZZZ', '5511999998888'),
    ).rejects.toThrow('Não encontrei o pedido PED-ZZZZ');
  });

  it('lança DomainError se o pedido já expirou', async () => {
    const repositorio = criarOrdersRepositoryFake();
    const criado = await criarPedido(repositorio, carrinhoValido(), 20, new Date('2026-01-01T10:00:00Z'));

    await expect(
      confirmarRecebimentoCliente(
        repositorio,
        criado.codigoCurto,
        '5511999998888',
        new Date('2026-01-01T10:30:00Z'),
      ),
    ).rejects.toThrow('expirou');
  });

  it('devolve o pedido sem mudança quando ele já aguarda pagamento (para reenviar o PIX)', async () => {
    const repositorio = criarOrdersRepositoryFake();
    const criado = await criarPedido(repositorio, carrinhoValido(), 20, new Date('2026-01-01T10:00:00Z'));
    await confirmarRecebimentoCliente(repositorio, criado.codigoCurto, '5511999998888', new Date('2026-01-01T10:05:00Z'));

    const denovo = await confirmarRecebimentoCliente(
      repositorio,
      criado.codigoCurto,
      '5511900001111',
      new Date('2026-01-01T10:30:00Z'),
    );

    expect(denovo.status).toBe('AGUARDANDO_PAGAMENTO');
    expect(denovo.telefoneCliente).toBe('5511999998888');
  });

  it('explica sem código técnico quando o pedido já foi pago', async () => {
    const repositorio = criarOrdersRepositoryFake();
    const criado = await criarPedido(repositorio, carrinhoValido(), 20, new Date('2026-01-01T10:00:00Z'));
    await repositorio.atualizar(criado.id, { status: 'PAGO' });

    const erro = confirmarRecebimentoCliente(repositorio, criado.codigoCurto, '5511999998888');

    await expect(erro).rejects.toThrow(`O pedido ${criado.codigoCurto} já foi pago`);
    await expect(erro).rejects.not.toThrow('PAGO');
  });
});

describe('confirmarPagamento', () => {
  it('marca pedido como PAGO a partir de AGUARDANDO_PAGAMENTO', async () => {
    const repositorio = criarOrdersRepositoryFake();
    const criado = await criarPedido(repositorio, carrinhoValido(), 20, new Date('2026-01-01T10:00:00Z'));
    await confirmarRecebimentoCliente(
      repositorio,
      criado.codigoCurto,
      '5511999998888',
      new Date('2026-01-01T10:05:00Z'),
    );

    const pago = await confirmarPagamento(repositorio, criado.id, { status: 'AGUARDANDO_PAGAMENTO' });

    expect(pago.status).toBe('PAGO');
    expect(pago.confirmadoEm).toBeInstanceOf(Date);
  });

  it('lança DomainError se pedido não está em AGUARDANDO_PAGAMENTO', async () => {
    const repositorio = criarOrdersRepositoryFake();
    await expect(
      confirmarPagamento(repositorio, 'pedido-x', { status: 'AGUARDANDO_CONFIRMACAO' }),
    ).rejects.toThrow('não pode ser marcado como pago');
  });
});

describe('expirarPedidosPendentes', () => {
  it('expira apenas pedidos vencidos que ainda aguardam confirmação', async () => {
    const repositorio = criarOrdersRepositoryFake();
    const vencido = await criarPedido(repositorio, carrinhoValido(), 20, new Date('2026-01-01T09:00:00Z'));
    const emDia = await criarPedido(repositorio, carrinhoValido(), 20, new Date('2026-01-01T10:00:00Z'));

    const expirados = await expirarPedidosPendentes(repositorio, new Date('2026-01-01T10:00:00Z'));

    expect(expirados.map((p) => p.id)).toEqual([vencido.id]);
    const pedidoEmDia = await repositorio.buscarPorCodigo(emDia.codigoCurto);
    expect(pedidoEmDia?.status).toBe('AGUARDANDO_CONFIRMACAO');
  });
});
