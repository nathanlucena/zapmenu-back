import { describe, expect, it } from 'vitest';
import type { ConversaPersistida, ConversationRepository } from '../conversation/conversation.repository.js';
import { contextoInicial } from '../conversation/conversation-state.types.js';
import { criarGestaoRepositoryFake } from './__mocks__/gestao.repository.fake.js';
import { criarPreviasRepositoryFake } from './__mocks__/previas.repository.fake.js';
import { criarInterpretadorRoteiroFake } from './__mocks__/interpretador.roteiro.fake.js';
import { criarCadastroPorLista } from './cadastro-empreendedores.js';
import { reconhecerComandoDePromocao } from './comandos.js';
import { interpretarRespostaDaIA } from './deepseek-interpretador.js';
import { processarMensagemGestao, type GestaoDeps, type RespostaGestao } from './gestao.service.js';
import type { ItemSnapshot } from './gestao.repository.js';
import type { PromocaoProposta } from './interpretador.js';
import { criarAssinaturasRepositoryFake } from '../../planos/__mocks__/assinaturas.repository.fake.js';
import { criarPromocoesRepositoryFake } from '../../promocoes/__mocks__/promocoes.repository.fake.js';

const TELEFONE = '5581999990000';

const ITENS: ItemSnapshot[] = [
  { id: 'calabresa', nome: 'Calabresa', precoBase: 50, ativo: true, temFoto: false, variacoes: [], categoriaId: 'pizzas', categoriaNome: 'Pizzas' },
  { id: 'mussarela', nome: 'Mussarela', precoBase: 45, ativo: true, temFoto: false, variacoes: [], categoriaId: 'pizzas', categoriaNome: 'Pizzas' },
  { id: 'coca', nome: 'Coca 2L', precoBase: 14, ativo: true, temFoto: false, variacoes: [], categoriaId: 'bebidas', categoriaNome: 'Bebidas' },
];

function criarCenario(plano: 'ESSENCIAL' | 'PROFISSIONAL' = 'PROFISSIONAL') {
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
  const promocoes = criarPromocoesRepositoryFake();
  promocoes.definirLoja(TELEFONE, { lojaId: 'loja-1', telefone: TELEFONE, fuso: 'America/Sao_Paulo' });
  const ia = criarInterpretadorRoteiroFake();
  const gestaoRepo = criarGestaoRepositoryFake({
    loja: { nome: 'Pizzaria do Zé' },
    itens: ITENS,
    categorias: [
      { id: 'pizzas', nome: 'Pizzas' },
      { id: 'bebidas', nome: 'Bebidas' },
    ],
    lojaSalva: { existe: true, temLogo: false, temCapa: false, naoLembrarOpcionais: true },
  });
  const previas = criarPreviasRepositoryFake();
  const deps: GestaoDeps = {
    conversationRepo,
    gestaoRepo,
    interpretador: ia,
    cadastro: criarCadastroPorLista([]),
    previas: { repo: previas, urlDaImagem: (id) => `http://front.test/api/previa/${id}` },
    planos: { repo: assinaturas, mensageiro: { enviarTexto: async () => undefined }, linkDosPlanos: 'https://zapmenu.test/#planos' },
    promocoes: { repo: promocoes, mensageiro: { enviarTexto: async () => undefined } },
  };
  const enviar = (texto: string) => processarMensagemGestao({ telefone: TELEFONE, texto }, deps);
  const propor = (promocao: PromocaoProposta, texto = 'promoção') => {
    ia.responder({ resposta: 'Anotei a promoção!', operacoes: [{ tipo: 'NOVA_PROMOCAO', promocao }] });
    return enviar(texto);
  };
  return { enviar, propor, promocoes, previas, gestaoRepo, ia, conversa: () => conversa };
}

const textos = (respostas: RespostaGestao[]) => respostas.filter((r): r is string => typeof r === 'string').join('\n---\n');
const imagens = (respostas: RespostaGestao[]) => respostas.filter((r) => typeof r === 'object' && 'imagemUrl' in r);

const QUARTA_E_QUINTA_DA_CALABRESA: PromocaoProposta = {
  tipo: 'PRECO_FIXO',
  valor: 39.9,
  alvo: { tipo: 'ITENS', ids: ['calabresa'] },
  diasSemana: [4, 3],
};

describe('IA: operação nova_promocao', () => {
  it('lê preço fixo com dias e o percentual por categoria', () => {
    const fixa = interpretarRespostaDaIA(
      JSON.stringify({
        resposta: 'ok',
        operacoes: [{ tipo: 'nova_promocao', preco: '39,90', itens: ['calabresa'], dias: ['qua', 'qui'], ate: '2026-11-30' }],
      }),
    );
    expect(fixa.operacoes[0]).toEqual({
      tipo: 'NOVA_PROMOCAO',
      promocao: { tipo: 'PRECO_FIXO', valor: 39.9, alvo: { tipo: 'ITENS', ids: ['calabresa'] }, diasSemana: [3, 4], ate: '2026-11-30' },
    });
    const percentual = interpretarRespostaDaIA(
      JSON.stringify({ resposta: 'ok', operacoes: [{ tipo: 'nova_promocao', percentual: 10, categorias: ['pizzas'] }] }),
    );
    expect(percentual.operacoes[0]).toMatchObject({ promocao: { tipo: 'PERCENTUAL', valor: 10, alvo: { tipo: 'CATEGORIAS', ids: ['pizzas'] }, diasSemana: [] } });
  });
});

describe('comandos das promoções', () => {
  it('entende listar, pausar, reativar e remover com o número', () => {
    expect(reconhecerComandoDePromocao('minhas promoções')).toEqual({ tipo: 'LISTAR' });
    expect(reconhecerComandoDePromocao('Pausar promoção 2')).toEqual({ tipo: 'PAUSAR', numero: 2 });
    expect(reconhecerComandoDePromocao('reativar a promoção 1')).toEqual({ tipo: 'REATIVAR', numero: 1 });
    expect(reconhecerComandoDePromocao('remover promoção nº 3')).toEqual({ tipo: 'REMOVER', numero: 3 });
    expect(reconhecerComandoDePromocao('quero uma promoção de pizza')).toBeUndefined();
  });
});

describe('gestão: promoções', () => {
  it('"toda quarta e quinta a calabresa sai por 39,90": resumo, prévia com preço riscado e "sim" grava', async () => {
    const cenario = criarCenario();

    const respostas = await cenario.propor(QUARTA_E_QUINTA_DA_CALABRESA, 'toda quarta e quinta a calabresa sai por 39,90');

    const texto = textos(respostas);
    expect(texto).toContain('Calabresa por R$ 39,90 · quarta e quinta');
    expect(texto).toContain('• Calabresa: ~R$ 50,00~ → *R$ 39,90*');
    expect(texto).toContain('Confirma?');
    expect(imagens(respostas)).toHaveLength(1);
    expect([...cenario.previas.guardadas.values()][0]?.itens[0]).toMatchObject({
      marca: 'PROMOCAO',
      precoBase: 50,
      precoPromocional: 39.9,
      selo: 'Promoção',
    });
    expect(cenario.promocoes.promocoes).toHaveLength(0);

    expect(textos(await cenario.enviar('sim'))).toContain('✅ Promoção criada');
    expect(cenario.promocoes.promocoes[0]).toMatchObject({ tipo: 'PRECO_FIXO', valor: 39.9, diasSemana: [3, 4], ativa: true });
    // O preço do item não foi mexido: nada passou pelo rascunho.
    expect(cenario.gestaoRepo.salvos).toHaveLength(0);
  });

  it('"não" descarta', async () => {
    const cenario = criarCenario();
    await cenario.propor(QUARTA_E_QUINTA_DA_CALABRESA);
    expect(textos(await cenario.enviar('não'))).toContain('descartei a promoção');
    expect(cenario.promocoes.promocoes).toHaveLength(0);
  });

  it('desconto acima de 50% pede o "sim" duas vezes', async () => {
    const cenario = criarCenario();
    await cenario.propor({ tipo: 'PERCENTUAL', valor: 60, alvo: { tipo: 'LOJA' }, diasSemana: [] });
    expect(textos(await cenario.enviar('sim'))).toContain('Tem certeza?');
    expect(cenario.promocoes.promocoes).toHaveLength(0);
    await cenario.enviar('sim');
    expect(cenario.promocoes.promocoes).toHaveLength(1);
  });

  it('preço fixo acima do preço normal é recusado com o motivo', async () => {
    const cenario = criarCenario();
    const texto = textos(await cenario.propor({ ...QUARTA_E_QUINTA_DA_CALABRESA, valor: 55 }));
    expect(texto).toContain('o preço da promoção precisa ser menor');
    expect(cenario.conversa().contexto.promocaoPendente).toBeUndefined();
  });

  it('Básico: a promoção é recusada com o convite para o Profissional', async () => {
    const cenario = criarCenario('ESSENCIAL');
    const respostas = await cenario.propor(QUARTA_E_QUINTA_DA_CALABRESA);
    expect(textos(respostas)).toContain('Isso faz parte do plano *Profissional*');
    expect(cenario.conversa().contexto.promocaoPendente).toBeUndefined();
    expect(textos(await cenario.enviar('minhas promoções'))).toContain('Isso faz parte do plano *Profissional*');
  });

  it('minhas promoções, pausar, reativar e remover', async () => {
    const cenario = criarCenario();
    await cenario.propor(QUARTA_E_QUINTA_DA_CALABRESA);
    await cenario.enviar('sim');
    await cenario.propor({ tipo: 'PERCENTUAL', valor: 10, alvo: { tipo: 'CATEGORIAS', ids: ['bebidas'] }, diasSemana: [] });
    await cenario.enviar('sim');

    const lista = textos(await cenario.enviar('minhas promoções'));
    expect(lista).toContain('1. Calabresa por R$ 39,90 · quarta e quinta');
    expect(lista).toContain('2. 10% de desconto em Bebidas · todos os dias — ✅ valendo agora');

    expect(textos(await cenario.enviar('pausar promoção 1'))).toContain('⏸️ Promoção pausada');
    expect(cenario.promocoes.promocoes[0]?.ativa).toBe(false);
    expect(textos(await cenario.enviar('reativar promoção 1'))).toContain('reativada');
    expect(cenario.promocoes.promocoes[0]?.ativa).toBe(true);
    expect(textos(await cenario.enviar('remover promoção 2'))).toContain('🗑️ Promoção removida');
    expect(cenario.promocoes.promocoes).toHaveLength(1);
    expect(textos(await cenario.enviar('pausar promoção 9'))).toContain('Não achei a promoção 9');
    expect(cenario.ia.entradas).toHaveLength(2);
  });
});
