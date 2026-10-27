import { describe, expect, it } from 'vitest';
import type { ConversaPersistida, ConversationRepository } from '../conversation/conversation.repository.js';
import { contextoInicial } from '../conversation/conversation-state.types.js';
import { criarGestaoRepositoryFake } from './__mocks__/gestao.repository.fake.js';
import { criarInterpretadorRoteiroFake } from './__mocks__/interpretador.roteiro.fake.js';
import { criarCadastroPorLista } from './cadastro-empreendedores.js';
import { reconhecerComandoDePlano } from './comandos.js';
import { processarMensagemGestao, type GestaoDeps, type RespostaGestao } from './gestao.service.js';
import { criarAssinaturasRepositoryFake } from '../../planos/__mocks__/assinaturas.repository.fake.js';
import { criarGatewayAssinaturasFake } from '../../planos/__mocks__/gateway-assinaturas.fake.js';
import type { Assinatura } from '../../planos/domain/assinatura.js';

const TELEFONE = '5581999990000';

function criarCenario(assinatura?: Partial<Assinatura>) {
  let conversa: ConversaPersistida = { telefone: TELEFONE, estado: 'OCIOSO', contexto: contextoInicial() };
  const conversationRepo: ConversationRepository = {
    async obterOuCriar() {
      return structuredClone(conversa);
    },
    async salvar(nova) {
      conversa = structuredClone(nova);
    },
  };
  const assinaturas = criarAssinaturasRepositoryFake();
  assinaturas.definirLoja({ empreendedorId: 'emp-1', telefone: TELEFONE }, assinatura);
  const gateway = criarGatewayAssinaturasFake();
  const ia = criarInterpretadorRoteiroFake();
  const deps: GestaoDeps = {
    conversationRepo,
    gestaoRepo: criarGestaoRepositoryFake({
      loja: { nome: 'Pizzaria do Zé' },
      lojaSalva: { existe: true, temLogo: false, temCapa: false, naoLembrarOpcionais: true },
    }),
    interpretador: ia,
    cadastro: criarCadastroPorLista([]),
    planos: { repo: assinaturas, gateway, mensageiro: { enviarTexto: async () => undefined }, linkDosPlanos: 'https://zapmenu.test/#planos' },
  };
  const enviar = async (texto: string) => textos(await processarMensagemGestao({ telefone: TELEFONE, texto }, deps));
  return { enviar, assinaturas, gateway, ia, deps, conversa: () => conversa, assinatura: () => assinaturas.assinaturaDe('emp-1') };
}

const textos = (respostas: RespostaGestao[]) => respostas.filter((r): r is string => typeof r === 'string').join('\n---\n');

const ATIVA_PROFISSIONAL = {
  plano: 'PROFISSIONAL',
  periodo: 'MENSAL',
  status: 'ATIVA',
  mpPreapprovalId: 'pre-9',
  emailCobranca: 'loja@teste.com',
  proximaCobranca: new Date('2026-11-27T15:00:00Z'),
} as const;

describe('reconhecerComandoDePlano', () => {
  it('entende os comandos e o plano/período', () => {
    expect(reconhecerComandoDePlano('Meu plano')).toEqual({ tipo: 'MEU_PLANO' });
    expect(reconhecerComandoDePlano('qual é o meu plano?')).toEqual({ tipo: 'MEU_PLANO' });
    expect(reconhecerComandoDePlano('assinar')).toEqual({ tipo: 'ASSINAR', plano: undefined, periodo: undefined });
    expect(reconhecerComandoDePlano('Assinar Básico')).toEqual({ tipo: 'ASSINAR', plano: 'ESSENCIAL', periodo: undefined });
    expect(reconhecerComandoDePlano('assinar o plano profissional anual')).toEqual({ tipo: 'ASSINAR', plano: 'PROFISSIONAL', periodo: 'ANUAL' });
    expect(reconhecerComandoDePlano('regularizar')).toEqual({ tipo: 'ASSINAR', regularizar: true });
    expect(reconhecerComandoDePlano('mudar de plano')).toEqual({ tipo: 'MUDAR_PLANO', plano: undefined });
    expect(reconhecerComandoDePlano('mudar para o básico')).toEqual({ tipo: 'MUDAR_PLANO', plano: 'ESSENCIAL' });
    expect(reconhecerComandoDePlano('cancelar assinatura')).toEqual({ tipo: 'CANCELAR_ASSINATURA' });
  });

  it('não confunde com o resto da conversa', () => {
    expect(reconhecerComandoDePlano('cancelar')).toBeUndefined();
    expect(reconhecerComandoDePlano('quero mudar o preço da pizza')).toBeUndefined();
    expect(reconhecerComandoDePlano('assinar o cardápio com meu nome')).toBeUndefined();
  });
});

describe('gestão: assinatura pela conversa', () => {
  it('"meu plano" responde sem IA', async () => {
    const cenario = criarCenario();
    const texto = await cenario.enviar('meu plano');
    expect(texto).toContain('*Seu plano: Profissional* (teste grátis até');
    expect(cenario.ia.entradas).toHaveLength(0);
  });

  it('"assinar" sem plano mostra as opções com preço', async () => {
    const texto = await criarCenario().enviar('assinar');
    expect(texto).toContain('*assinar básico*: R$ 29,99/mês');
    expect(texto).toContain('*assinar profissional*: R$ 59,99/mês');
  });

  it('assinar pede o e-mail do Mercado Pago, depois manda o link', async () => {
    const cenario = criarCenario();

    expect(await cenario.enviar('assinar profissional anual')).toContain('e-mail da sua conta do Mercado Pago');
    expect(await cenario.enviar('não sei')).toContain('não parece um e-mail');
    const resposta = await cenario.enviar('loja@teste.com');

    expect(resposta).toContain('https://mp.test/assinar/pre-1');
    expect(resposta).toContain('R$ 599,88/ano');
    expect(resposta).toContain('A primeira cobrança só acontece em');
    expect(cenario.gateway.criadas[0]).toMatchObject({ email: 'loja@teste.com', referencia: 'emp-1:PROFISSIONAL:ANUAL' });
    expect(cenario.conversa().contexto.assinatura).toBeUndefined();
    expect(cenario.ia.entradas).toHaveLength(0);
  });

  it('"cancelar" no meio desiste da assinatura', async () => {
    const cenario = criarCenario();
    await cenario.enviar('assinar básico');
    expect(await cenario.enviar('cancelar')).toContain('não assinei nada');
    expect(cenario.gateway.criadas).toHaveLength(0);
  });

  it('Mercado Pago fora do ar: avisa para tentar de novo', async () => {
    const cenario = criarCenario({ status: 'TESTE', emailCobranca: 'loja@teste.com' });
    cenario.gateway.falharNaProximaCriacao();
    expect(await cenario.enviar('assinar básico')).toContain('Não consegui falar com o Mercado Pago');
  });

  it('downgrade pede confirmação e fica para a próxima cobrança', async () => {
    const cenario = criarCenario(ATIVA_PROFISSIONAL);

    const pergunta = await cenario.enviar('mudar de plano');
    expect(pergunta).toContain('Você continua no *Profissional* até 27/11');
    expect(pergunta).toContain('*Básico* (R$ 29,99/mês)');
    const feito = await cenario.enviar('sim');

    expect(feito).toContain('a partir de 27/11 sua loja fica no plano *Básico*');
    expect(cenario.assinatura()).toMatchObject({ plano: 'PROFISSIONAL', planoProximoCiclo: 'ESSENCIAL' });
    expect(cenario.gateway.valoresAlterados).toEqual([{ id: 'pre-9', valorCentavos: 2999 }]);
  });

  it('upgrade vale na hora', async () => {
    const cenario = criarCenario({ ...ATIVA_PROFISSIONAL, plano: 'ESSENCIAL' });
    expect(await cenario.enviar('mudar para o profissional')).toContain('começa a valer agora');
    expect(await cenario.enviar('sim')).toContain('Sua loja está no plano *Profissional*');
    expect(cenario.assinatura()?.plano).toBe('PROFISSIONAL');
  });

  it('"não" deixa como está', async () => {
    const cenario = criarCenario(ATIVA_PROFISSIONAL);
    await cenario.enviar('mudar de plano');
    expect(await cenario.enviar('não')).toContain('nada mudou');
    expect(cenario.gateway.valoresAlterados).toEqual([]);
  });

  it('mudar de plano no teste explica que é só assinar', async () => {
    expect(await criarCenario().enviar('mudar de plano')).toContain('Você está no teste grátis do *Profissional*');
  });

  it('cancelar assinatura com confirmação: ativa até o fim do período', async () => {
    const cenario = criarCenario(ATIVA_PROFISSIONAL);
    expect(await cenario.enviar('cancelar assinatura')).toContain('continua no ar até 27/11');
    const feito = await cenario.enviar('sim');
    expect(feito).toContain('Assinatura cancelada');
    expect(cenario.assinatura()?.status).toBe('CANCELADA');
    expect(cenario.gateway.canceladas).toEqual(['pre-9']);
  });

  it('loja suspensa: a gestão só aceita os comandos do plano', async () => {
    const cenario = criarCenario({ ...ATIVA_PROFISSIONAL, status: 'SUSPENSA' });

    expect(await cenario.enviar('entrou pizza de frango 40')).toContain('fora do ar por falta de assinatura');
    expect(cenario.ia.entradas).toHaveLength(0);

    // "regularizar" assina de novo o plano que ela tinha, com o e-mail já conhecido.
    const link = await cenario.enviar('regularizar');
    expect(link).toContain('https://mp.test/assinar/pre-1');
    expect(cenario.gateway.criadas[0]?.referencia).toBe('emp-1:PROFISSIONAL:MENSAL');
  });
});
