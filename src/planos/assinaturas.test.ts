import { describe, expect, it } from 'vitest';
import { criarIdempotencyRepositoryFake } from '../shared/idempotency/__mocks__/idempotency.repository.fake.js';
import { criarAssinaturasRepositoryFake } from './__mocks__/assinaturas.repository.fake.js';
import { criarGatewayAssinaturasFake } from './__mocks__/gateway-assinaturas.fake.js';
import {
  assinar,
  cancelarAssinaturaDaLoja,
  descreverMeuPlano,
  lerReferencia,
  montarReferencia,
  mudarDePlano,
} from './application/assinar.js';
import { processarNotificacaoAssinatura } from './application/processar-notificacao-assinatura.js';
import { verificarAssinaturas } from './application/verificar-assinaturas.js';
import { lojaDisponivel, planoEfetivo, podeUsar } from './domain/assinatura.js';

const TELEFONE = '5581999990000';
const DIA = 24 * 60 * 60_000;
const INICIO = new Date('2026-10-01T15:00:00Z');
const depois = (dias: number) => new Date(INICIO.getTime() + dias * DIA);

function cenario() {
  const repo = criarAssinaturasRepositoryFake();
  repo.definirLoja({ empreendedorId: 'emp-1', telefone: TELEFONE });
  const gateway = criarGatewayAssinaturasFake();
  const enviados: string[] = [];
  const deps = {
    repo,
    gateway,
    idempotency: criarIdempotencyRepositoryFake(),
    mensageiro: { enviarTexto: async (_telefone: string, texto: string) => void enviados.push(texto) },
    linkDosPlanos: 'https://zapmenu.test/#planos',
  };
  let evento = 0;
  const notificar = (tipo: string, recursoId: string, agora = INICIO) =>
    processarNotificacaoAssinatura(deps, { eventoId: `ev-${++evento}`, tipo, recursoId }, agora);

  /** Loja assina e o Mercado Pago autoriza o cartão. */
  async function assinarEAutorizar(plano: 'ESSENCIAL' | 'PROFISSIONAL', agora = INICIO, proximaCobranca = depois(30)) {
    await assinar(deps, { identificador: TELEFONE, plano, periodo: 'MENSAL', email: 'loja@teste.com' }, agora);
    const criada = gateway.criadas.at(-1)!;
    gateway.definirAssinatura({ id: criada.id, situacao: 'AUTORIZADA', referencia: criada.referencia, proximaCobranca });
    await notificar('subscription_preapproval', criada.id, agora);
    return criada.id;
  }
  return { repo, gateway, enviados, deps, notificar, assinarEAutorizar, assinatura: () => repo.assinaturaDe('emp-1')! };
}

describe('referência da assinatura no Mercado Pago', () => {
  it('ida e volta, e recusa o que não é nosso', () => {
    const referencia = { empreendedorId: 'emp-1', plano: 'PROFISSIONAL', periodo: 'ANUAL' } as const;
    expect(lerReferencia(montarReferencia(referencia))).toEqual(referencia);
    expect(lerReferencia('pedido-123')).toBeUndefined();
    expect(lerReferencia('emp-1:PREMIUM:MENSAL')).toBeUndefined();
  });
});

describe('assinatura: teste → ativa', () => {
  it('assinar no teste cria a cobrança para o fim do teste; a autorização ativa o plano escolhido', async () => {
    const { deps, gateway, enviados, notificar, assinatura } = cenario();

    const { linkPagamento, primeiraCobranca } = await assinar(
      deps,
      { identificador: TELEFONE, plano: 'ESSENCIAL', periodo: 'ANUAL', email: ' Loja@Teste.com ' },
      depois(3),
    );

    expect(linkPagamento).toBe('https://mp.test/assinar/pre-1');
    expect(gateway.criadas[0]).toMatchObject({
      referencia: 'emp-1:ESSENCIAL:ANUAL',
      email: 'loja@teste.com',
      valorCentavos: 2499 * 12,
      meses: 12,
      descricao: 'ZapMenu Básico (anual)',
    });
    // O teste começou na primeira chamada (dia 3): a cobrança fica para o fim dele.
    expect(primeiraCobranca).toEqual(assinatura().fimTeste);
    expect(assinatura()).toMatchObject({ status: 'TESTE', emailCobranca: 'loja@teste.com' });

    gateway.definirAssinatura({ id: 'pre-1', situacao: 'AUTORIZADA', referencia: 'emp-1:ESSENCIAL:ANUAL', proximaCobranca: depois(14) });
    await notificar('subscription_preapproval', 'pre-1');

    expect(assinatura()).toMatchObject({ status: 'ATIVA', plano: 'ESSENCIAL', periodo: 'ANUAL', mpPreapprovalId: 'pre-1', proximaCobranca: depois(14) });
    expect(planoEfetivo(assinatura())).toBe('ESSENCIAL');
    expect(enviados.at(-1)).toContain('Assinatura confirmada');
    expect(enviados.at(-1)).toContain('*Básico*');
  });

  it('notificação repetida não processa duas vezes', async () => {
    const { deps, gateway, enviados } = cenario();
    await assinar(deps, { identificador: TELEFONE, plano: 'PROFISSIONAL', periodo: 'MENSAL', email: 'a@b.com' }, INICIO);
    gateway.definirAssinatura({ id: 'pre-1', situacao: 'AUTORIZADA', referencia: 'emp-1:PROFISSIONAL:MENSAL' });

    const notificacao = { eventoId: 'ev-x', tipo: 'subscription_preapproval', recursoId: 'pre-1' };
    await processarNotificacaoAssinatura(deps, notificacao, INICIO);
    await processarNotificacaoAssinatura(deps, notificacao, INICIO);

    expect(enviados.filter((texto) => texto.includes('confirmada'))).toHaveLength(1);
  });

  it('assinatura pendente (cartão não cadastrado ainda) não muda nada', async () => {
    const { deps, notificar, assinatura } = cenario();
    await assinar(deps, { identificador: TELEFONE, plano: 'PROFISSIONAL', periodo: 'MENSAL', email: 'a@b.com' }, INICIO);
    await notificar('subscription_preapproval', 'pre-1');
    expect(assinatura().status).toBe('TESTE');
  });

  it('não assina de novo o mesmo plano, nem com e-mail inválido, nem sem o Mercado Pago', async () => {
    const { deps, assinarEAutorizar } = cenario();
    await expect(
      assinar(deps, { identificador: TELEFONE, plano: 'PROFISSIONAL', periodo: 'MENSAL', email: 'sem-arroba' }),
    ).rejects.toMatchObject({ code: 'EMAIL_INVALIDO' });
    await expect(
      assinar({ ...deps, gateway: undefined }, { identificador: TELEFONE, plano: 'PROFISSIONAL', periodo: 'MENSAL', email: 'a@b.com' }),
    ).rejects.toMatchObject({ code: 'ASSINATURA_INDISPONIVEL' });

    await assinarEAutorizar('ESSENCIAL');
    await expect(
      assinar(deps, { identificador: TELEFONE, plano: 'ESSENCIAL', periodo: 'MENSAL', email: 'a@b.com' }),
    ).rejects.toMatchObject({ code: 'JA_ASSINA' });
    await expect(
      assinar(deps, { identificador: TELEFONE, plano: 'PROFISSIONAL', periodo: 'MENSAL', email: 'a@b.com' }),
    ).rejects.toMatchObject({ code: 'ASSINATURA_JA_ATIVA' });
    await expect(
      assinar(deps, { identificador: 'nao-existe', plano: 'PROFISSIONAL', periodo: 'MENSAL', email: 'a@b.com' }),
    ).rejects.toMatchObject({ code: 'LOJA_NAO_ENCONTRADA' });
  });

  it('notificação de uma assinatura que não é do ZapMenu', async () => {
    const { gateway, notificar } = cenario();
    gateway.definirAssinatura({ id: 'pre-x', situacao: 'AUTORIZADA', referencia: 'outra-coisa' });
    await expect(notificar('subscription_preapproval', 'pre-x')).rejects.toMatchObject({ code: 'ASSINATURA_NAO_ENCONTRADA' });
  });
});

describe('assinatura: recusa → pendente → suspensa → regularizada', () => {
  it('ciclo completo da cobrança recusada', async () => {
    const { deps, gateway, enviados, notificar, assinarEAutorizar, assinatura } = cenario();
    const antiga = await assinarEAutorizar('PROFISSIONAL');

    // A renovação do mês é recusada: PENDENTE e aviso na hora.
    gateway.definirCobranca({ id: 'cob-1', assinaturaId: antiga, situacao: 'RECUSADA' });
    await notificar('subscription_authorized_payment', 'cob-1', depois(30));
    expect(assinatura()).toMatchObject({ status: 'PENDENTE', pendenteDesde: depois(30) });
    expect(enviados.at(-1)).toContain('Não conseguimos cobrar');
    expect(lojaDisponivel(assinatura())).toBe(true);

    // O job do mesmo dia não repete; no dia seguinte avisa de novo.
    const avisos = enviados.length;
    await verificarAssinaturas(deps, new Date(depois(30).getTime() + 3_600_000));
    expect(enviados).toHaveLength(avisos);
    await verificarAssinaturas(deps, depois(31));
    expect(enviados).toHaveLength(avisos + 1);
    expect(enviados.at(-1)).toContain('em 4 dias');

    // 5 dias depois: SUSPENSA, vitrine fora do ar.
    await verificarAssinaturas(deps, depois(35));
    expect(assinatura().status).toBe('SUSPENSA');
    expect(lojaDisponivel(assinatura())).toBe(false);
    expect(enviados.at(-1)).toContain('5 dias sem pagamento');

    // Regulariza com outro cartão: assinatura nova, a antiga é cancelada no Mercado Pago.
    await assinarEAutorizar('PROFISSIONAL', depois(36), depois(66));
    expect(assinatura()).toMatchObject({ status: 'ATIVA', mpPreapprovalId: 'pre-2', pendenteDesde: undefined });
    expect(gateway.canceladas).toEqual([antiga]);
    expect(lojaDisponivel(assinatura())).toBe(true);
  });

  it('nova tentativa aprovada na mesma assinatura também regulariza', async () => {
    const { gateway, enviados, notificar, assinarEAutorizar, assinatura } = cenario();
    const id = await assinarEAutorizar('PROFISSIONAL');
    gateway.definirCobranca({ id: 'cob-1', assinaturaId: id, situacao: 'RECUSADA' });
    await notificar('subscription_authorized_payment', 'cob-1', depois(30));

    gateway.definirCobranca({ id: 'cob-2', assinaturaId: id, situacao: 'APROVADA' });
    gateway.definirAssinatura({ id, situacao: 'AUTORIZADA', referencia: 'emp-1:PROFISSIONAL:MENSAL', proximaCobranca: depois(60) });
    await notificar('subscription_authorized_payment', 'cob-2', depois(32));

    expect(assinatura()).toMatchObject({ status: 'ATIVA', proximaCobranca: depois(60), pendenteDesde: undefined });
    expect(enviados.at(-1)).toContain('Pagamento da assinatura confirmado');
  });
});

describe('mudança de plano', () => {
  it('upgrade vale na hora e o Mercado Pago passa a cobrar o novo valor', async () => {
    const { deps, gateway, assinarEAutorizar, assinatura } = cenario();
    const id = await assinarEAutorizar('ESSENCIAL');
    expect(podeUsar(assinatura(), 'ENTREGA_POR_DISTANCIA')).toBe(false);

    const { quando } = await mudarDePlano(deps, TELEFONE, 'PROFISSIONAL', depois(5));

    expect(quando).toBe('AGORA');
    expect(assinatura().plano).toBe('PROFISSIONAL');
    expect(podeUsar(assinatura(), 'ENTREGA_POR_DISTANCIA')).toBe(true);
    expect(gateway.valoresAlterados).toEqual([{ id, valorCentavos: 5999 }]);
  });

  it('downgrade fica para a próxima cobrança aprovada', async () => {
    const { deps, gateway, notificar, assinarEAutorizar, assinatura } = cenario();
    const id = await assinarEAutorizar('PROFISSIONAL');

    const { quando } = await mudarDePlano(deps, TELEFONE, 'ESSENCIAL', depois(5));

    expect(quando).toBe('PROXIMO_CICLO');
    expect(assinatura()).toMatchObject({ plano: 'PROFISSIONAL', planoProximoCiclo: 'ESSENCIAL' });
    expect(podeUsar(assinatura(), 'CORES_CAPA')).toBe(true);
    expect(gateway.valoresAlterados).toEqual([{ id, valorCentavos: 2999 }]);

    gateway.definirCobranca({ id: 'cob-1', assinaturaId: id, situacao: 'APROVADA' });
    gateway.definirAssinatura({ id, situacao: 'AUTORIZADA', referencia: 'emp-1:PROFISSIONAL:MENSAL', proximaCobranca: depois(60) });
    await notificar('subscription_authorized_payment', 'cob-1', depois(30));

    expect(assinatura()).toMatchObject({ plano: 'ESSENCIAL', planoProximoCiclo: undefined, status: 'ATIVA' });
    expect(podeUsar(assinatura(), 'CORES_CAPA')).toBe(false);
  });

  it('não muda de plano no teste', async () => {
    const { deps } = cenario();
    await expect(mudarDePlano(deps, TELEFONE, 'ESSENCIAL')).rejects.toMatchObject({ code: 'ASSINATURA_NAO_ATIVA' });
  });
});

describe('cancelamento', () => {
  it('para as cobranças, segue no plano até o fim do período e depois a loja sai do ar', async () => {
    const { deps, gateway, enviados, assinarEAutorizar, assinatura } = cenario();
    const id = await assinarEAutorizar('PROFISSIONAL', INICIO, depois(30));

    const cancelada = await cancelarAssinaturaDaLoja(deps, TELEFONE, depois(10));

    expect(gateway.canceladas).toEqual([id]);
    expect(cancelada).toMatchObject({ status: 'CANCELADA', canceladaEm: depois(10) });
    expect(podeUsar(assinatura(), 'ENTREGA_POR_DISTANCIA')).toBe(true);
    expect(lojaDisponivel(assinatura())).toBe(true);

    await verificarAssinaturas(deps, depois(29));
    expect(assinatura().status).toBe('CANCELADA');
    await verificarAssinaturas(deps, depois(30));
    expect(assinatura().status).toBe('SUSPENSA');
    expect(enviados.at(-1)).toContain('assinatura cancelada terminou');
  });

  it('cancelada no próprio Mercado Pago também vale até o fim do período', async () => {
    const { gateway, enviados, notificar, assinarEAutorizar, assinatura } = cenario();
    const id = await assinarEAutorizar('PROFISSIONAL', INICIO, depois(30));
    gateway.definirAssinatura({ id, situacao: 'CANCELADA', referencia: 'emp-1:PROFISSIONAL:MENSAL' });

    await notificar('subscription_preapproval', id, depois(3));

    expect(assinatura()).toMatchObject({ status: 'CANCELADA', proximaCobranca: depois(30) });
    expect(enviados.at(-1)).toContain('cancelada no Mercado Pago');
  });
});

describe('job diário no teste', () => {
  it('avisa nos dias 10 e 13 com o convite e suspende no fim do teste sem assinatura', async () => {
    const { deps, repo, enviados, assinatura } = cenario();
    await repo.obterOuIniciarTeste(TELEFONE, INICIO);

    await verificarAssinaturas(deps, depois(10));
    await verificarAssinaturas(deps, depois(10.5));
    await verificarAssinaturas(deps, depois(13));
    await verificarAssinaturas(deps, depois(14));

    expect(enviados).toHaveLength(3);
    expect(enviados[0]).toContain('acaba em 4 dias');
    expect(enviados[0]).toContain('*assinar profissional*');
    expect(enviados[0]).toContain('https://zapmenu.test/#planos');
    expect(enviados[1]).toContain('acaba amanhã');
    expect(enviados[2]).toContain('teste grátis acabou');
    expect(assinatura().status).toBe('SUSPENSA');
  });
});

describe('meu plano', () => {
  it('mostra o plano, a situação e o uso do mês', async () => {
    const { deps, repo, assinarEAutorizar } = cenario();
    await assinarEAutorizar('ESSENCIAL', INICIO, new Date('2026-11-01T15:00:00Z'));
    repo.registrarVenda('emp-1', new Date('2026-10-05T15:00:00Z'));
    repo.registrarVenda('emp-1', new Date('2026-09-28T15:00:00Z'));
    repo.definirProdutos('emp-1', 12);

    const texto = await descreverMeuPlano(deps, TELEFONE, new Date('2026-10-10T15:00:00Z'));

    expect(texto).toContain('*Seu plano: Básico* (R$ 29,99/mês, próxima cobrança em 01/11)');
    expect(texto).toContain('Pedidos este mês: 1 de 100');
    expect(texto).toContain('Produtos: 12 de 30');
    expect(texto).toContain('*mudar de plano*');
  });

  it('no teste mostra até quando vai e os limites do Profissional', async () => {
    const { deps } = cenario();
    const texto = await descreverMeuPlano(deps, TELEFONE, INICIO);
    expect(texto).toContain('*Seu plano: Profissional* (teste grátis até 15/10)');
    expect(texto).toContain('Produtos: 0 (ilimitado)');
    expect(texto).toContain('Pedidos este mês: 0 de 1.500');
  });
});
