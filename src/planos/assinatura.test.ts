import { describe, expect, it } from 'vitest';
import {
  assinaturaAutorizada,
  avisoDeLimiteDePedidos,
  cancelarAssinatura,
  cobrancaAprovada,
  cobrancaRecusada,
  formatarCentavos,
  iniciarTeste,
  limite,
  lojaDisponivel,
  mudarPlano,
  planoEfetivo,
  planoQueLibera,
  podeUsar,
  valorDaCobrancaCentavos,
  verificarAssinatura,
  type Assinatura,
} from './domain/assinatura.js';
import { RECURSOS } from './domain/catalogo.js';
import { diaNoFuso, intervaloDoMes, mesNoFuso } from './domain/calendario.js';

const FUSO = 'America/Sao_Paulo';
const DIA = 24 * 60 * 60_000;
const INICIO = new Date('2026-10-01T15:00:00Z');

function ativa(dados: Partial<Assinatura> = {}): Assinatura {
  return {
    empreendedorId: 'emp-1',
    plano: 'PROFISSIONAL',
    periodo: 'MENSAL',
    status: 'ATIVA',
    mpPreapprovalId: 'pre-1',
    proximaCobranca: new Date('2026-11-01T15:00:00Z'),
    ...dados,
  };
}

describe('recursos e limites por plano', () => {
  it('Básico: nenhum recurso pago, 100 pedidos, 30 produtos e sem cotas', () => {
    const basico = { plano: 'ESSENCIAL', status: 'ATIVA' } as const;
    for (const recurso of RECURSOS) {
      expect(podeUsar(basico, recurso), recurso).toBe(false);
    }
    expect(limite(basico, 'pedidosMes')).toBe(100);
    expect(limite(basico, 'produtos')).toBe(30);
    expect(limite(basico, 'minutosAudioMes')).toBe(0);
    expect(limite(basico, 'sugestoesIaMes')).toBe(0);
  });

  it('Profissional: todos os recursos (inclusive relatório diário), 1.500 pedidos e produtos ilimitados', () => {
    const profissional = { plano: 'PROFISSIONAL', status: 'ATIVA' } as const;
    for (const recurso of RECURSOS) {
      expect(podeUsar(profissional, recurso), recurso).toBe(true);
    }
    expect(limite(profissional, 'pedidosMes')).toBe(1500);
    expect(limite(profissional, 'produtos')).toBeNull();
    expect(limite(profissional, 'minutosAudioMes')).toBe(60);
    expect(limite(profissional, 'sugestoesIaMes')).toBe(100);
  });

  it('TESTE usa os limites do Profissional, mesmo com outro plano gravado', () => {
    const teste = { plano: 'ESSENCIAL', status: 'TESTE' } as const;
    expect(planoEfetivo(teste)).toBe('PROFISSIONAL');
    expect(podeUsar(teste, 'ENTREGA_POR_DISTANCIA')).toBe(true);
    expect(podeUsar(teste, 'SEM_SELO')).toBe(true);
    expect(limite(teste, 'produtos')).toBeNull();
    expect(limite(teste, 'pedidosMes')).toBe(1500);
  });

  it('loja sem assinatura gravada é tratada como em teste', () => {
    expect(planoEfetivo(undefined)).toBe('PROFISSIONAL');
    expect(podeUsar(null, 'PREVIA_IMAGEM')).toBe(true);
    expect(lojaDisponivel(undefined)).toBe(true);
  });

  it('só a SUSPENSA tira a loja do ar', () => {
    expect(lojaDisponivel({ plano: 'PROFISSIONAL', status: 'SUSPENSA' })).toBe(false);
    for (const status of ['TESTE', 'ATIVA', 'PENDENTE', 'CANCELADA'] as const) {
      expect(lojaDisponivel({ plano: 'ESSENCIAL', status })).toBe(true);
    }
  });

  it('o bot oferece o Profissional para recursos pagos', () => {
    expect(planoQueLibera('CORES_CAPA')).toBe('PROFISSIONAL');
  });

  it('preço da cobrança: mês, ou o ano de uma vez, em centavos', () => {
    expect(valorDaCobrancaCentavos('ESSENCIAL', 'MENSAL')).toBe(2999);
    expect(valorDaCobrancaCentavos('ESSENCIAL', 'ANUAL')).toBe(2499 * 12);
    expect(valorDaCobrancaCentavos('PROFISSIONAL', 'MENSAL')).toBe(5999);
    expect(valorDaCobrancaCentavos('PROFISSIONAL', 'ANUAL')).toBe(4999 * 12);
    expect(formatarCentavos(2999)).toBe('R$ 29,99');
  });
});

describe('ciclo da assinatura', () => {
  it('loja nova: TESTE de 14 dias no Profissional', () => {
    const teste = iniciarTeste('emp-1', INICIO);
    expect(teste).toMatchObject({ status: 'TESTE', plano: 'PROFISSIONAL' });
    expect(teste.fimTeste!.getTime() - INICIO.getTime()).toBe(14 * DIA);
  });

  it('teste → ativa quando o Mercado Pago autoriza', () => {
    const autorizada = assinaturaAutorizada(iniciarTeste('emp-1', INICIO), {
      plano: 'ESSENCIAL',
      periodo: 'ANUAL',
      mpPreapprovalId: 'pre-9',
      proximaCobranca: new Date('2026-10-15T15:00:00Z'),
    });
    expect(autorizada).toMatchObject({ status: 'ATIVA', plano: 'ESSENCIAL', periodo: 'ANUAL', mpPreapprovalId: 'pre-9' });
    expect(planoEfetivo(autorizada)).toBe('ESSENCIAL');
  });

  it('recusa → pendente (prazo conta da primeira recusa) → aprovada volta a ativa', () => {
    const recusada = cobrancaRecusada(ativa(), INICIO);
    expect(recusada).toMatchObject({ status: 'PENDENTE', pendenteDesde: INICIO });
    const deNovo = cobrancaRecusada(recusada, new Date(INICIO.getTime() + DIA));
    expect(deNovo.pendenteDesde).toEqual(INICIO);
    const paga = cobrancaAprovada(deNovo, new Date('2026-12-01T15:00:00Z'));
    expect(paga).toMatchObject({ status: 'ATIVA', pendenteDesde: undefined, proximaCobranca: new Date('2026-12-01T15:00:00Z') });
  });

  it('upgrade vale na hora', () => {
    const { quando, assinatura } = mudarPlano(ativa({ plano: 'ESSENCIAL' }), 'PROFISSIONAL');
    expect(quando).toBe('AGORA');
    expect(assinatura.plano).toBe('PROFISSIONAL');
  });

  it('downgrade fica marcado e entra na próxima cobrança aprovada', () => {
    const { quando, assinatura } = mudarPlano(ativa(), 'ESSENCIAL');
    expect(quando).toBe('PROXIMO_CICLO');
    expect(assinatura).toMatchObject({ plano: 'PROFISSIONAL', planoProximoCiclo: 'ESSENCIAL' });
    expect(cobrancaAprovada(assinatura)).toMatchObject({ plano: 'ESSENCIAL', planoProximoCiclo: undefined });
  });

  it('voltar ao plano atual desfaz o downgrade marcado', () => {
    const marcado = mudarPlano(ativa(), 'ESSENCIAL').assinatura;
    expect(mudarPlano(marcado, 'PROFISSIONAL').assinatura.planoProximoCiclo).toBeUndefined();
  });

  it('não muda de plano sem assinatura ativa nem para o mesmo plano', () => {
    expect(() => mudarPlano(iniciarTeste('emp-1', INICIO), 'ESSENCIAL')).toThrow(
      expect.objectContaining({ code: 'ASSINATURA_NAO_ATIVA' }),
    );
    expect(() => mudarPlano(ativa(), 'PROFISSIONAL')).toThrow(expect.objectContaining({ code: 'MESMO_PLANO' }));
    expect(() => cancelarAssinatura(iniciarTeste('emp-1', INICIO), INICIO)).toThrow('Não há assinatura ativa');
  });

  it('cancelada segue no plano até o fim do período pago e depois é suspensa', () => {
    const cancelada = cancelarAssinatura(ativa(), INICIO);
    expect(cancelada).toMatchObject({ status: 'CANCELADA', canceladaEm: INICIO });
    expect(podeUsar(cancelada, 'CORES_CAPA')).toBe(true);
    expect(verificarAssinatura(cancelada, new Date('2026-10-20T12:00:00Z'), FUSO).eventos).toEqual([]);
    const depois = verificarAssinatura(cancelada, new Date('2026-11-01T15:00:00Z'), FUSO);
    expect(depois.assinatura.status).toBe('SUSPENSA');
    expect(depois.eventos).toEqual([{ tipo: 'CANCELADA_ENCERRADA' }]);
  });
});

describe('verificação diária', () => {
  it('avisa no dia 10 e no dia 13 do teste, uma vez cada', () => {
    let assinatura = iniciarTeste('emp-1', INICIO);
    const noDia = (dia: number, horas = 1) => new Date(INICIO.getTime() + dia * DIA + horas * 3_600_000);

    expect(verificarAssinatura(assinatura, noDia(9), FUSO).eventos).toEqual([]);

    const dia10 = verificarAssinatura(assinatura, noDia(10), FUSO);
    expect(dia10.eventos).toEqual([{ tipo: 'AVISO_FIM_DO_TESTE', dia: 10, diasRestantes: 4 }]);
    assinatura = dia10.assinatura;
    expect(verificarAssinatura(assinatura, noDia(10, 5), FUSO).eventos).toEqual([]);
    expect(verificarAssinatura(assinatura, noDia(12), FUSO).eventos).toEqual([]);

    const dia13 = verificarAssinatura(assinatura, noDia(13), FUSO);
    expect(dia13.eventos).toEqual([{ tipo: 'AVISO_FIM_DO_TESTE', dia: 13, diasRestantes: 1 }]);
    assinatura = dia13.assinatura;
    expect(verificarAssinatura(assinatura, noDia(13, 6), FUSO).eventos).toEqual([]);
  });

  it('teste acabado sem assinatura → SUSPENSA', () => {
    const fim = verificarAssinatura(iniciarTeste('emp-1', INICIO), new Date(INICIO.getTime() + 14 * DIA), FUSO);
    expect(fim.assinatura.status).toBe('SUSPENSA');
    expect(fim.eventos).toEqual([{ tipo: 'TESTE_ENCERRADO' }]);
  });

  it('pendente: aviso uma vez por dia e suspensão no 5º dia', () => {
    let assinatura = cobrancaRecusada(ativa(), INICIO);
    const primeiro = verificarAssinatura(assinatura, new Date(INICIO.getTime() + 60_000), FUSO);
    expect(primeiro.eventos).toEqual([{ tipo: 'COBRANCA_PENDENTE', diasParaSuspender: 5 }]);
    assinatura = primeiro.assinatura;
    expect(verificarAssinatura(assinatura, new Date(INICIO.getTime() + 3 * 3_600_000), FUSO).eventos).toEqual([]);

    const segundo = verificarAssinatura(assinatura, new Date(INICIO.getTime() + DIA), FUSO);
    expect(segundo.eventos).toEqual([{ tipo: 'COBRANCA_PENDENTE', diasParaSuspender: 4 }]);

    const suspensa = verificarAssinatura(segundo.assinatura, new Date(INICIO.getTime() + 5 * DIA), FUSO);
    expect(suspensa.assinatura.status).toBe('SUSPENSA');
    expect(suspensa.eventos).toEqual([{ tipo: 'SUSPENSA_POR_FALTA_DE_PAGAMENTO' }]);
  });

  it('ativa e suspensa não geram nada', () => {
    expect(verificarAssinatura(ativa(), INICIO, FUSO).eventos).toEqual([]);
    expect(verificarAssinatura(ativa({ status: 'SUSPENSA' }), INICIO, FUSO).eventos).toEqual([]);
  });
});

describe('aviso do limite de pedidos', () => {
  const basico = ativa({ plano: 'ESSENCIAL' });

  it('80% e 100%, uma vez por mês cada', () => {
    expect(avisoDeLimiteDePedidos(basico, 79, '2026-10').aviso).toBeUndefined();

    const em80 = avisoDeLimiteDePedidos(basico, 80, '2026-10');
    expect(em80.aviso).toEqual({ faixa: 80, usados: 80, limite: 100 });
    expect(avisoDeLimiteDePedidos(em80.assinatura, 95, '2026-10').aviso).toBeUndefined();

    const em100 = avisoDeLimiteDePedidos(em80.assinatura, 100, '2026-10');
    expect(em100.aviso).toEqual({ faixa: 100, usados: 100, limite: 100 });
    expect(avisoDeLimiteDePedidos(em100.assinatura, 130, '2026-10').aviso).toBeUndefined();

    // Mês novo: volta a avisar.
    expect(avisoDeLimiteDePedidos(em100.assinatura, 80, '2026-11').aviso?.faixa).toBe(80);
  });

  it('quem pula direto para 100% recebe só esse', () => {
    const { assinatura, aviso } = avisoDeLimiteDePedidos(basico, 100, '2026-10');
    expect(aviso?.faixa).toBe(100);
    expect(avisoDeLimiteDePedidos(assinatura, 100, '2026-10').aviso).toBeUndefined();
  });

  it('TESTE avisa pelos 1.500 do Profissional', () => {
    const teste = iniciarTeste('emp-1', INICIO);
    expect(avisoDeLimiteDePedidos(teste, 100, '2026-10').aviso).toBeUndefined();
    expect(avisoDeLimiteDePedidos(teste, 1200, '2026-10').aviso).toEqual({ faixa: 80, usados: 1200, limite: 1500 });
  });
});

describe('calendário no fuso da loja', () => {
  it('o mês vira à meia-noite de São Paulo, não do UTC', () => {
    // 31/10 22:00 em São Paulo = 01/11 01:00 UTC.
    const agora = new Date('2026-11-01T01:00:00Z');
    expect(mesNoFuso(agora, FUSO)).toBe('2026-10');
    expect(diaNoFuso(agora, FUSO)).toBe('2026-10-31');
    const { inicio, fim } = intervaloDoMes(agora, FUSO);
    expect(inicio.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(fim.toISOString()).toBe('2026-11-01T03:00:00.000Z');
  });

  it('dezembro termina no dia 1º de janeiro', () => {
    const { fim } = intervaloDoMes(new Date('2026-12-15T12:00:00Z'), FUSO);
    expect(fim.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });
});
