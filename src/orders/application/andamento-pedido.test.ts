import { describe, expect, it } from 'vitest';
import { criarOrdersRepositoryFake } from '../__mocks__/orders.repository.fake.js';
import { extrairAndamentoPedido } from '../domain/pedido.js';
import { atualizarAndamento, concluirPedidosAntigos, pedirAndamentoDaLoja } from './andamento-pedido.js';
import { criarPedido } from './criar-pedido.js';

const carrinho = { empreendedorId: 'emp-1', itens: [{ itemCardapioId: 'i1', quantidade: 1, precoUnitario: 10 }] };

describe('extrairAndamentoPedido', () => {
  it('lê "saiu"/"pronto" como a caminho e "entregue"/"retirado" como concluído', () => {
    expect(extrairAndamentoPedido('saiu PED-7KQ2')).toEqual({ andamento: 'A_CAMINHO', codigoCurto: 'PED-7KQ2' });
    expect(extrairAndamentoPedido('Pronto o ped-7kq2')).toEqual({ andamento: 'A_CAMINHO', codigoCurto: 'PED-7KQ2' });
    expect(extrairAndamentoPedido('entregue PED-7KQ2')).toEqual({ andamento: 'CONCLUIDO', codigoCurto: 'PED-7KQ2' });
    expect(extrairAndamentoPedido('quero o PED-7KQ2')).toBeNull();
  });

  it('lê as etapas do varejo: separei, enviei (com rastreio) e entreguei', () => {
    expect(extrairAndamentoPedido('separei PED-7KQ2')).toEqual({ andamento: 'SEPARADO', codigoCurto: 'PED-7KQ2' });
    expect(extrairAndamentoPedido('entreguei PED-7KQ2')).toEqual({ andamento: 'CONCLUIDO', codigoCurto: 'PED-7KQ2' });
    expect(extrairAndamentoPedido('enviei PED-7KQ2 rastreio nx123456789br')).toEqual({
      andamento: 'ENVIADO',
      codigoCurto: 'PED-7KQ2',
      rastreio: { codigoRastreio: 'NX123456789BR', transportadora: 'Correios' },
    });
    expect(extrairAndamentoPedido('Enviado PED-7KQ2 pela jadlog, código 10203040506')?.rastreio).toEqual({
      codigoRastreio: '10203040506',
      transportadora: 'Jadlog',
    });
    expect(extrairAndamentoPedido('enviei PED-7KQ2')?.rastreio).toBeUndefined();
  });
});

describe('atualizarAndamento nas etapas do varejo', () => {
  const DONO = '5511900000001';
  const deps = (repo: ReturnType<typeof criarOrdersRepositoryFake>) => ({
    ordersRepo: repo,
    contatos: { telefoneDe: async () => DONO },
  });

  it('pedido de retirada não pode ser enviado', async () => {
    const repo = criarOrdersRepositoryFake();
    const pedido = await repo.atualizar((await criarPedido(repo, carrinho, 20)).id, { status: 'PAGO' });

    await expect(atualizarAndamento(deps(repo), pedido, 'ENVIADO', DONO)).rejects.toMatchObject({ code: 'TRANSICAO_INVALIDA' });
    expect((await repo.buscarPorId(pedido.id))?.status).toBe('PAGO');
  });

  it('separado pode ficar pronto para retirar', async () => {
    const repo = criarOrdersRepositoryFake();
    const pedido = await repo.atualizar((await criarPedido(repo, carrinho, 20)).id, { status: 'PAGO' });

    const separado = await atualizarAndamento(deps(repo), pedido, 'SEPARADO', DONO);
    const pronto = await atualizarAndamento(deps(repo), separado, 'A_CAMINHO', DONO);

    expect(pronto.status).toBe('PRONTO_PARA_RETIRADA');
  });

  it('dois avisos da mesma etapa ao mesmo tempo: só o primeiro vale', async () => {
    const repo = criarOrdersRepositoryFake();
    const pedido = await repo.atualizar((await criarPedido(repo, carrinho, 20)).id, { status: 'PAGO' });

    const resultados = await Promise.allSettled([
      atualizarAndamento(deps(repo), pedido, 'SEPARADO', DONO),
      atualizarAndamento(deps(repo), pedido, 'SEPARADO', DONO),
    ]);

    expect(resultados.map((resultado) => resultado.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(resultados.find((resultado) => resultado.status === 'rejected')).toMatchObject({
      reason: { code: 'ANDAMENTO_REPETIDO' },
    });
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

  it('não conclui sozinho o que é do varejo: separado, enviado ou com tamanho/cor', async () => {
    const repo = criarOrdersRepositoryFake();
    const agora = new Date('2026-10-21T12:00:00Z');
    const ontem = new Date('2026-10-20T20:00:00Z');
    const enviado = await criarPedido(repo, carrinho, 20, ontem);
    const separado = await criarPedido(repo, carrinho, 20, ontem);
    const camiseta = await criarPedido(
      repo,
      { empreendedorId: 'emp-1', itens: [{ itemCardapioId: 'i2', skuId: 'sku-m', quantidade: 1, precoUnitario: 60 }] },
      20,
      ontem,
    );
    await repo.atualizar(enviado.id, { status: 'ENVIADO' });
    await repo.atualizar(separado.id, { status: 'SEPARADO' });
    await repo.atualizar(camiseta.id, { status: 'PAGO' });

    expect(await concluirPedidosAntigos(repo, 12, agora)).toEqual([]);
  });
});
