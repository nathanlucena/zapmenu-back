import { describe, expect, it } from 'vitest';
import { criarRelatoriosRepositoryFake } from './__mocks__/relatorios.repository.fake.js';
import { enviarRelatoriosAgendados, gerarRelatorio } from './application/relatorios.js';
import { mesAteAgora, ontem, relatoriosDoMomento, semanaPassada } from './domain/periodos.js';
import { resumirVendas, textoDoRelatorio, variacao, type PedidoParaRelatorio } from './domain/relatorio.js';

const FUSO = 'America/Sao_Paulo';

function pedido(dados: Partial<PedidoParaRelatorio> & { confirmadoEm?: Date } = {}): PedidoParaRelatorio & { confirmadoEm: Date } {
  return {
    status: 'CONCLUIDO',
    valorTotal: 50,
    criadoEm: new Date('2026-10-21T22:30:00Z'), // 19h30 em São Paulo
    confirmadoEm: new Date('2026-10-21T22:35:00Z'),
    modalidade: 'ENTREGA',
    formaPagamento: 'PIX',
    itens: [{ nome: 'Calabresa', quantidade: 1, precoUnitario: 45 }],
    ...dados,
  };
}

describe('cálculos do relatório', () => {
  it('conta só pagos ou confirmados (e o que veio depois), com ticket, divisões e pico no fuso', () => {
    const pedidos = [
      pedido(),
      pedido({ status: 'PAGO', valorTotal: 30.5, modalidade: 'RETIRADA', itens: [{ nome: 'Coca', quantidade: 3, precoUnitario: 10 }] }),
      pedido({ status: 'CONFIRMADO', valorTotal: 40, formaPagamento: 'DINHEIRO', criadoEm: new Date('2026-10-22T15:10:00Z') }),
      pedido({ status: 'EXPIRADO', valorTotal: 999 }),
      pedido({ status: 'RECUSADO', valorTotal: 999 }),
      pedido({ status: 'AGUARDANDO_PAGAMENTO', valorTotal: 999 }),
    ];

    const resumo = resumirVendas(pedidos, FUSO);

    expect(resumo).toMatchObject({ total: 120.5, pedidos: 3, ticketMedio: 40.17 });
    expect(resumo.maisVendidos).toEqual([
      { nome: 'Coca', quantidade: 3 },
      { nome: 'Calabresa', quantidade: 2 },
    ]);
    expect(resumo.porModalidade).toEqual({ ENTREGA: 2, RETIRADA: 1 });
    expect(resumo.porPagamento).toEqual({ PIX: 2, DINHEIRO: 1 });
    expect(resumo.pico).toEqual({ hora: 19, pedidos: 2 });
  });

  it('mais vendidos para nos 5', () => {
    const itens = ['A', 'B', 'C', 'D', 'E', 'F'].map((nome, i) => ({ nome, quantidade: 10 - i, precoUnitario: 1 }));
    expect(resumirVendas([pedido({ itens })], FUSO).maisVendidos.map((item) => item.nome)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('variação em relação ao período anterior', () => {
    expect(variacao(112, 100)).toBe('▲ 12%');
    expect(variacao(95, 100)).toBe('▼ 5%');
    expect(variacao(100, 100)).toBe('= 0%');
    expect(variacao(10, 0)).toBeUndefined();
  });

  it('texto com setas, divisões e pico; semana sem pedidos vira uma mensagem curta', () => {
    const atual = resumirVendas([pedido(), pedido({ formaPagamento: 'CARTAO', modalidade: 'RETIRADA' })], FUSO);
    const anterior = resumirVendas([pedido({ valorTotal: 80 })], FUSO);
    const texto = textoDoRelatorio('Vendas da semana', atual, anterior, 'a semana anterior');
    expect(texto).toContain('Total vendido: *R$ 100,00 (▲ 25%)*');
    expect(texto).toContain('Pedidos: *2 (▲ 100%)*');
    expect(texto).toContain('1. Calabresa — 2');
    expect(texto).toContain('🛵 Entrega 50% · Retirada 50%');
    expect(texto).toContain('💳 PIX 50% · Cartão na entrega 50%');
    expect(texto).toContain('Horário de pico: 19h às 20h (2 pedidos)');

    const vazio = textoDoRelatorio('Vendas da semana', resumirVendas([], FUSO), anterior);
    expect(vazio).toBe('📊 *Vendas da semana*\nNenhuma venda neste período. No período anterior foi 1 pedido.');
  });
});

describe('períodos e agendamento no fuso da loja', () => {
  // Segunda, 26/10/2026, 9h em São Paulo = 12h UTC.
  const SEGUNDA_9H = new Date('2026-10-26T12:00:00Z');

  it('semana passada: de segunda a domingo, e a anterior para comparar', () => {
    const semana = semanaPassada(SEGUNDA_9H, FUSO);
    expect(semana.de.toISOString()).toBe('2026-10-19T03:00:00.000Z');
    expect(semana.ate.toISOString()).toBe('2026-10-26T03:00:00.000Z');
    expect(semana.anterior.de.toISOString()).toBe('2026-10-12T03:00:00.000Z');
    expect(semana.titulo).toBe('Vendas da semana (19/10 a 25/10)');
    expect(semanaPassada(new Date('2026-10-28T15:00:00Z'), FUSO).chave).toBe('2026-10-19');
  });

  it('ontem é o dia de São Paulo, mesmo depois da meia-noite UTC', () => {
    // Terça 27/10 às 01h UTC = segunda 26/10 às 22h em São Paulo: ontem é domingo 25/10.
    expect(ontem(new Date('2026-10-27T01:00:00Z'), FUSO).chave).toBe('2026-10-25');
  });

  it('semanal só na segunda a partir das 9h; diário todo dia a partir das 8h (horário de São Paulo)', () => {
    const tipos = (agora: Date) => relatoriosDoMomento(agora, FUSO).map((envio) => envio.tipo);
    expect(tipos(new Date('2026-10-26T10:59:00Z'))).toEqual([]); // segunda 7h59
    expect(tipos(new Date('2026-10-26T11:00:00Z'))).toEqual(['DIARIO']); // segunda 8h
    expect(tipos(SEGUNDA_9H)).toEqual(['SEMANAL', 'DIARIO']);
    expect(tipos(new Date('2026-10-27T12:00:00Z'))).toEqual(['DIARIO']); // terça 9h
  });

  it('mês até agora, comparado com o mesmo trecho do mês passado', () => {
    const mes = mesAteAgora(new Date('2026-10-10T15:00:00Z'), FUSO);
    expect(mes.de.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(mes.anterior.de.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(mes.anterior.ate.toISOString()).toBe('2026-09-10T15:00:00.000Z');
  });
});

describe('envio automático', () => {
  const SEGUNDA_9H = new Date('2026-10-26T12:00:00Z');

  function cenario(plano: 'ESSENCIAL' | 'PROFISSIONAL' = 'PROFISSIONAL', extra: { relatorioDiario?: boolean; status?: 'ATIVA' | 'SUSPENSA' } = {}) {
    const repo = criarRelatoriosRepositoryFake();
    repo.lojas.push({
      lojaId: 'loja-1',
      empreendedorId: 'emp-1',
      telefone: '5581999990000',
      fuso: FUSO,
      relatorioDiario: extra.relatorioDiario ?? true,
      plano: { plano, status: extra.status ?? 'ATIVA' },
    });
    repo.definirVendas('emp-1', [pedido(), pedido({ confirmadoEm: new Date('2026-10-25T20:00:00Z') })]);
    const enviados: string[] = [];
    const deps = { repo, mensageiro: { enviarTexto: async (_telefone: string, texto: string) => void enviados.push(texto) } };
    return { repo, enviados, deps };
  }

  it('Profissional: segunda às 9h recebe o semanal e o diário, uma vez só', async () => {
    const { enviados, deps } = cenario();
    await enviarRelatoriosAgendados(deps, SEGUNDA_9H);
    await enviarRelatoriosAgendados(deps, new Date(SEGUNDA_9H.getTime() + 30 * 60_000));
    expect(enviados).toHaveLength(2);
    expect(enviados[0]).toContain('Vendas da semana (19/10 a 25/10)');
    expect(enviados[0]).toContain('Pedidos: *2*');
    expect(enviados[1]).toContain('Vendas de ontem (25/10)');
    expect(enviados[1]).toContain('*parar relatório diário*');
  });

  it('diário desligado: só o semanal', async () => {
    const { enviados, deps } = cenario('PROFISSIONAL', { relatorioDiario: false });
    await enviarRelatoriosAgendados(deps, SEGUNDA_9H);
    expect(enviados).toHaveLength(1);
  });

  it('Básico e loja suspensa não recebem', async () => {
    for (const [plano, status] of [['ESSENCIAL', 'ATIVA'], ['PROFISSIONAL', 'SUSPENSA']] as const) {
      const { enviados, deps } = cenario(plano, { status });
      await enviarRelatoriosAgendados(deps, SEGUNDA_9H);
      expect(enviados).toEqual([]);
    }
  });

  it('relatório sob demanda compara com o período anterior', async () => {
    const { repo } = cenario();
    const texto = await gerarRelatorio(repo, { empreendedorId: 'emp-1', fuso: FUSO }, semanaPassada(SEGUNDA_9H, FUSO));
    expect(texto).toContain('Total vendido: *R$ 100,00*');
  });
});
