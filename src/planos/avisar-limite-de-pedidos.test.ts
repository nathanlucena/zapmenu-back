import { describe, expect, it } from 'vitest';
import { criarAssinaturasRepositoryFake } from './__mocks__/assinaturas.repository.fake.js';
import { avisarLimiteDePedidos } from './application/avisar-limite-de-pedidos.js';

const AGORA = new Date('2026-10-20T15:00:00Z');

function cenario(plano: 'ESSENCIAL' | 'PROFISSIONAL', status: 'ATIVA' | 'TESTE' = 'ATIVA') {
  const repo = criarAssinaturasRepositoryFake();
  repo.definirLoja({ empreendedorId: 'emp-1', telefone: '5581999990000' }, { plano, status });
  const enviados: string[] = [];
  const deps = {
    repo,
    mensageiro: { enviarTexto: async (_telefone: string, texto: string) => void enviados.push(texto) },
    linkDosPlanos: 'https://zapmenu.test/#planos',
  };
  const vender = async (quantas: number, em = AGORA) => {
    for (let i = 0; i < quantas; i++) {
      repo.registrarVenda('emp-1', em);
      await avisarLimiteDePedidos(deps, 'emp-1', em);
    }
  };
  return { repo, enviados, vender };
}

describe('aviso do limite de pedidos do mês', () => {
  it('Básico: avisa no 80º e no 100º pedido, uma vez cada, e segue aceitando', async () => {
    const { enviados, vender } = cenario('ESSENCIAL');

    await vender(79);
    expect(enviados).toEqual([]);
    await vender(1);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toContain('80 dos 100 pedidos do mês no plano *Básico*');
    expect(enviados[0]).toContain('*mudar de plano*');
    expect(enviados[0]).toContain('https://zapmenu.test/#planos');

    await vender(25);
    expect(enviados).toHaveLength(2);
    expect(enviados[1]).toContain('chegou a 100 pedidos este mês');
    expect(enviados[1]).toContain('continuam chegando normalmente');
  });

  it('o mês é contado no fuso da loja e o aviso volta no mês seguinte', async () => {
    const { enviados, vender } = cenario('ESSENCIAL');
    // 80 vendas em outubro (horário de Brasília), a última às 23h de 31/10.
    await vender(79, new Date('2026-10-15T12:00:00Z'));
    await vender(1, new Date('2026-11-01T02:00:00Z'));
    expect(enviados).toHaveLength(1);

    // Novembro começa do zero.
    await vender(79, new Date('2026-11-10T12:00:00Z'));
    expect(enviados).toHaveLength(1);
    await vender(1, new Date('2026-11-10T12:00:00Z'));
    expect(enviados).toHaveLength(2);
  });

  it('TESTE e Profissional contam pelos 1.500', async () => {
    const { enviados, vender } = cenario('PROFISSIONAL', 'TESTE');
    await vender(100);
    expect(enviados).toEqual([]);
  });
});
