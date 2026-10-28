import { describe, expect, it } from 'vitest';
import type { ConversaPersistida, ConversationRepository } from '../conversation/conversation.repository.js';
import { contextoInicial } from '../conversation/conversation-state.types.js';
import { criarGestaoRepositoryFake } from './__mocks__/gestao.repository.fake.js';
import { criarInterpretadorRoteiroFake } from './__mocks__/interpretador.roteiro.fake.js';
import { criarGeradorDeDescricoesFake } from './__mocks__/gerador-de-descricoes.fake.js';
import { criarCadastroPorLista } from './cadastro-empreendedores.js';
import { reconhecerComandoDeDescricao } from './comandos.js';
import { promptDasDescricoes } from './deepseek-descricoes.js';
import { caberNaDescricao } from './gerador-de-descricoes.js';
import { processarMensagemGestao, type GestaoDeps, type RespostaGestao } from './gestao.service.js';
import type { ItemSnapshot } from './gestao.repository.js';
import { criarAssinaturasRepositoryFake } from '../../planos/__mocks__/assinaturas.repository.fake.js';
import { mesNoFuso } from '../../planos/domain/calendario.js';

const TELEFONE = '5581999990000';
const LOJA_COMPLETA = {
  nome: 'Pizzaria do Zé',
  slug: 'pizzaria-do-ze',
  aceitaRetirada: true,
  enderecoVerificado: { numero: '1', enderecoFormatado: 'Rua A, 1', latitude: 0, longitude: 0, precisao: 'ROOFTOP' },
  horarios: [{ dia: 'seg' as const, abre: '18:00', fecha: '23:00' }],
};

function pizza(id: string, nome: string, descricao?: string): ItemSnapshot {
  return { id, nome, descricao, precoBase: 40, ativo: true, temFoto: false, variacoes: [], categoriaId: 'pizzas', categoriaNome: 'Pizzas' };
}

function criarCenario(plano: 'ESSENCIAL' | 'PROFISSIONAL' = 'PROFISSIONAL', itens: ItemSnapshot[] = [pizza('calabresa', 'Calabresa')]) {
  let conversa: ConversaPersistida = { telefone: TELEFONE, estado: 'OCIOSO', contexto: contextoInicial() };
  const conversationRepo: ConversationRepository = {
    async obterOuCriar() {
      return structuredClone(conversa);
    },
    async salvar(nova) {
      conversa = structuredClone(nova);
    },
  };
  const cotas = criarAssinaturasRepositoryFake();
  cotas.definirLoja({ empreendedorId: 'emp-1', telefone: TELEFONE }, { plano, status: 'ATIVA' });
  const gerador = criarGeradorDeDescricoesFake();
  const ia = criarInterpretadorRoteiroFake();
  const gestaoRepo = criarGestaoRepositoryFake({
    loja: LOJA_COMPLETA,
    itens,
    categorias: [{ id: 'pizzas', nome: 'Pizzas' }],
    lojaSalva: { existe: true, temLogo: false, temCapa: false, naoLembrarOpcionais: true },
  });
  const deps: GestaoDeps = {
    conversationRepo,
    gestaoRepo,
    interpretador: ia,
    cadastro: criarCadastroPorLista([]),
    planos: { repo: cotas, mensageiro: { enviarTexto: async () => undefined }, linkDosPlanos: 'https://zapmenu.test/#planos' },
    descricoes: { gerador, cotas },
  };
  const enviar = async (texto: string) =>
    (await processarMensagemGestao({ telefone: TELEFONE, texto }, deps)).filter((r: RespostaGestao): r is string => typeof r === 'string').join('\n---\n');
  return { enviar, gerador, gestaoRepo, cotas, ia, conversa: () => conversa };
}

const descricaoSalva = (repo: ReturnType<typeof criarGestaoRepositoryFake>) => repo.salvos.at(-1)?.rascunho.edicoes[0];

describe('descrições com IA: regras', () => {
  it('o prompt proíbe inventar e promessas, e pede 2 opções de até 200 caracteres no tom do segmento', () => {
    const cardapio = promptDasDescricoes({ nome: 'Calabresa' });
    expect(cardapio).toContain('Não invente ingrediente, material, tecido, tamanho');
    expect(cardapio).toContain('o melhor da cidade');
    expect(cardapio).toContain('no máximo 200 caracteres');
    expect(cardapio).toContain('cardápio');
    expect(promptDasDescricoes({ nome: 'Camiseta', segmento: 'VAREJO' })).toContain('loja de roupas');
  });

  it('corta no fim de uma palavra, até 200 caracteres', () => {
    const longo = `${'palavra '.repeat(40)}fim`;
    const cortado = caberNaDescricao(longo);
    expect(cortado.length).toBeLessThanOrEqual(200);
    expect(cortado.endsWith('palavra')).toBe(true);
  });

  it('reconhece os comandos', () => {
    expect(reconhecerComandoDeDescricao('melhora a descrição da Calabresa')).toEqual({ tipo: 'ITEM', nome: 'calabresa' });
    expect(reconhecerComandoDeDescricao('melhora as descrições da categoria Pizzas')).toEqual({ tipo: 'CATEGORIA', nome: 'pizzas' });
  });
});

describe('gestão: descrições com IA', () => {
  it('depois de cadastrar item sem descrição, oferece; "sim" mostra 2 opções e "1" salva', async () => {
    const cenario = criarCenario('PROFISSIONAL', []);
    cenario.ia.responder({ resposta: 'Anotei!', operacoes: [{ tipo: 'NOVO_ITEM', ref: 'n1', dados: { nome: 'Calabresa', precoBase: 40 } }], finalizou: true });
    await cenario.enviar('entrou calabresa 40, é isso');
    // O fake grava o rascunho; o item novo passa a existir no snapshot, como no banco.
    cenario.gestaoRepo.snapshot.itens = [pizza('calabresa', 'Calabresa')];

    expect(await cenario.enviar('sim')).toContain('Quer que eu escreva uma descrição para *Calabresa*?');
    const opcoes = await cenario.enviar('sim');
    expect(opcoes).toContain('1. Calabresa feita na hora');
    expect(opcoes).toContain('2. Peça a Calabresa');
    expect(cenario.gerador.pedidos[0]).toMatchObject({ nome: 'Calabresa', categoria: 'Pizzas' });

    expect(await cenario.enviar('1')).toContain('✅ Descrição de *Calabresa* salva');
    expect(descricaoSalva(cenario.gestaoRepo)).toEqual({ itemId: 'calabresa', descricao: 'Calabresa feita na hora, do jeito que você gosta.' });
    expect(await cenario.cotas.usoDaCota('emp-1', 'sugestoesIaMes', mesNoFuso(new Date(), 'America/Sao_Paulo'))).toBe(1);
  });

  it('"melhora a descrição da X": a pessoa pode escrever a própria', async () => {
    const cenario = criarCenario();
    await cenario.enviar('melhora a descrição da calabresa');
    await cenario.enviar('Molho de tomate, calabresa e cebola');
    expect(descricaoSalva(cenario.gestaoRepo)).toEqual({ itemId: 'calabresa', descricao: 'Molho de tomate, calabresa e cebola' });
    expect(cenario.ia.entradas).toHaveLength(0);
  });

  it('categoria: no máximo 10 por vez, uma de cada vez, com "pular"', async () => {
    const itens = Array.from({ length: 12 }, (_, i) => pizza(`p${i}`, `Pizza ${i}`));
    const cenario = criarCenario('PROFISSIONAL', itens);
    const primeira = await cenario.enviar('melhora as descrições da categoria pizzas');
    expect(primeira).toContain('Vou fazer os 10 primeiros');
    expect(primeira).toContain('*Pizza 0*');
    expect(primeira).toContain('mais 9');
    expect(await cenario.enviar('pular')).toContain('*Pizza 1*');
    expect(cenario.gestaoRepo.salvos).toHaveLength(0);
  });

  it('nada é salvo sem escolher; "cancelar" encerra', async () => {
    const cenario = criarCenario();
    await cenario.enviar('melhora a descrição da calabresa');
    expect(await cenario.enviar('cancelar')).toContain('sem descrições por agora');
    expect(cenario.gestaoRepo.salvos).toHaveLength(0);
  });

  it('cota de 100 por mês: quando acaba, avisa', async () => {
    const cenario = criarCenario();
    await cenario.cotas.somarUsoDaCota('emp-1', 'sugestoesIaMes', mesNoFuso(new Date(), 'America/Sao_Paulo'), 100);
    expect(await cenario.enviar('melhora a descrição da calabresa')).toContain('sugestões de descrição do seu plano neste mês acabaram');
    expect(cenario.gerador.pedidos).toHaveLength(0);
  });

  it('Básico: convite para o Profissional e nenhuma oferta depois de cadastrar', async () => {
    const cenario = criarCenario('ESSENCIAL');
    expect(await cenario.enviar('melhora a descrição da calabresa')).toContain('Isso faz parte do plano *Profissional*');

    cenario.ia.responder({ resposta: 'Anotei!', operacoes: [{ tipo: 'NOVO_ITEM', ref: 'n1', dados: { nome: 'Mussarela', precoBase: 40 } }], finalizou: true });
    await cenario.enviar('entrou mussarela 40, é isso');
    expect(await cenario.enviar('sim')).not.toContain('Quer que eu escreva');
  });
});
