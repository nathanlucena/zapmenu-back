import { describe, expect, it } from 'vitest';
import type { ConversaPersistida, ConversationRepository } from '../conversation/conversation.repository.js';
import { contextoInicial } from '../conversation/conversation-state.types.js';
import { criarGestaoRepositoryFake } from './__mocks__/gestao.repository.fake.js';
import { criarInterpretadorRoteiroFake } from './__mocks__/interpretador.roteiro.fake.js';
import { criarCadastroPorLista } from './cadastro-empreendedores.js';
import { reconhecerComandoDeRelatorio } from './comandos.js';
import { processarMensagemGestao, type GestaoDeps, type RespostaGestao } from './gestao.service.js';
import { criarAssinaturasRepositoryFake } from '../../planos/__mocks__/assinaturas.repository.fake.js';
import { criarRelatoriosRepositoryFake } from '../../relatorios/__mocks__/relatorios.repository.fake.js';

const TELEFONE = '5581999990000';

function criarCenario(plano: 'ESSENCIAL' | 'PROFISSIONAL') {
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
  assinaturas.definirLoja({ empreendedorId: 'emp-1', telefone: TELEFONE }, { plano, status: 'ATIVA' });
  const relatorios = criarRelatoriosRepositoryFake();
  relatorios.lojas.push({ lojaId: 'loja-1', empreendedorId: 'emp-1', telefone: TELEFONE, fuso: 'America/Sao_Paulo', relatorioDiario: true });
  const ia = criarInterpretadorRoteiroFake();
  const deps: GestaoDeps = {
    conversationRepo,
    gestaoRepo: criarGestaoRepositoryFake({
      loja: { nome: 'Pizzaria do Zé' },
      lojaSalva: { existe: true, temLogo: false, temCapa: false, naoLembrarOpcionais: true },
    }),
    interpretador: ia,
    cadastro: criarCadastroPorLista([]),
    planos: { repo: assinaturas, mensageiro: { enviarTexto: async () => undefined }, linkDosPlanos: 'https://zapmenu.test/#planos' },
    relatorios: { repo: relatorios, mensageiro: { enviarTexto: async () => undefined } },
  };
  const enviar = async (texto: string) =>
    (await processarMensagemGestao({ telefone: TELEFONE, texto }, deps)).filter((r: RespostaGestao): r is string => typeof r === 'string').join('\n');
  return { enviar, relatorios, ia };
}

describe('gestão: relatório de vendas', () => {
  it('reconhece os comandos', () => {
    expect(reconhecerComandoDeRelatorio('Relatório')).toBe('SEMANA');
    expect(reconhecerComandoDeRelatorio('relatório do mês')).toBe('MES');
    expect(reconhecerComandoDeRelatorio('vendas de hoje')).toBe('HOJE');
    expect(reconhecerComandoDeRelatorio('parar relatório diário')).toBe('PARAR_DIARIO');
    expect(reconhecerComandoDeRelatorio('relatório da pizza')).toBeUndefined();
  });

  it('Profissional: responde na hora, sem IA', async () => {
    const cenario = criarCenario('PROFISSIONAL');
    expect(await cenario.enviar('vendas de hoje')).toContain('Vendas de hoje (até agora)');
    expect(await cenario.enviar('relatório do mês')).toContain('Vendas do mês');
    expect(cenario.ia.entradas).toHaveLength(0);
  });

  it('parar e voltar o relatório diário', async () => {
    const cenario = criarCenario('PROFISSIONAL');
    expect(await cenario.enviar('parar relatório diário')).toContain('não mando mais o relatório diário');
    expect(cenario.relatorios.lojas[0]?.relatorioDiario).toBe(false);
    await cenario.enviar('voltar relatório diário');
    expect(cenario.relatorios.lojas[0]?.relatorioDiario).toBe(true);
  });

  it('Básico: convite para o Profissional', async () => {
    const cenario = criarCenario('ESSENCIAL');
    expect(await cenario.enviar('relatório')).toContain('Isso faz parte do plano *Profissional*');
  });
});
