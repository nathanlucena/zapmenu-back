import { describe, expect, it } from 'vitest';
import type { ConversaPersistida, ConversationRepository } from '../conversation/conversation.repository.js';
import { contextoInicial } from '../conversation/conversation-state.types.js';
import { criarGestaoRepositoryFake } from './__mocks__/gestao.repository.fake.js';
import { criarCadastroPorLista } from './cadastro-empreendedores.js';
import { processarMensagemGestao, type GestaoDeps, type RespostaGestao } from './gestao.service.js';
import type { EntradaConversa, InterpretadorMensagem, RespostaConversa } from './interpretador.js';
import { AVISO_SO_DA_LOJA, AVISO_SO_DO_CARDAPIO } from './permissoes-por-tipo.js';
import { OPCAO_CARDAPIO, OPCAO_LOJA, tipoDaResposta } from './tipo-da-loja.js';

const TELEFONE = '5581999990000';

/** Loja nova: ainda não escolheu entre cardápio e loja. */
function criarCenario(tipoPendente = true, segmento?: 'COMIDA' | 'VAREJO', roteiro: RespostaConversa[] = []) {
  let conversa: ConversaPersistida = { telefone: TELEFONE, estado: 'OCIOSO', contexto: contextoInicial() };
  const conversationRepo: ConversationRepository = {
    async obterOuCriar() {
      return structuredClone(conversa);
    },
    async salvar(nova) {
      conversa = structuredClone(nova);
    },
  };
  const gestaoRepo = criarGestaoRepositoryFake({
    segmento,
    lojaSalva: { existe: false, temLogo: false, temCapa: false, naoLembrarOpcionais: false, tipoPendente },
  });
  const entradas: EntradaConversa[] = [];
  const interpretador: InterpretadorMensagem = {
    async conversar(entrada) {
      entradas.push(entrada);
      return roteiro.shift() ?? { resposta: 'Oi!', operacoes: [], operacoesMalformadas: [], finalizou: false, mostrarCardapio: false };
    },
  };
  const deps: GestaoDeps = { conversationRepo, gestaoRepo, interpretador, cadastro: criarCadastroPorLista([]) };
  const enviar = (texto: string) => processarMensagemGestao({ telefone: TELEFONE, texto }, deps);
  return { gestaoRepo, entradas, enviar, conversa: () => conversa };
}

const textos = (respostas: RespostaGestao[]) => respostas.filter((r): r is string => typeof r === 'string').join('\n---\n');
const enquetes = (respostas: RespostaGestao[]) => respostas.filter((r) => typeof r === 'object' && 'enquete' in r);

describe('tipoDaResposta', () => {
  it('entende a opção da enquete, o número e palavras que só apontam para um tipo', () => {
    expect(tipoDaResposta(OPCAO_CARDAPIO)).toBe('COMIDA');
    expect(tipoDaResposta(OPCAO_LOJA)).toBe('VAREJO');
    expect(tipoDaResposta('1')).toBe('COMIDA');
    expect(tipoDaResposta(' 2 ')).toBe('VAREJO');
    expect(tipoDaResposta('Loja')).toBe('VAREJO');
    expect(tipoDaResposta('Cardápio')).toBe('COMIDA');
    expect(tipoDaResposta('vendo roupas femininas')).toBe('VAREJO');
    expect(tipoDaResposta('tenho uma lanchonete')).toBe('COMIDA');
  });

  it('não chuta quando a resposta é ambígua ou não fala de tipo', () => {
    expect(tipoDaResposta('vendo comida e roupa')).toBeUndefined();
    expect(tipoDaResposta('oi')).toBeUndefined();
    expect(tipoDaResposta('12')).toBeUndefined();
    expect(tipoDaResposta('quero cadastrar minha loja')).toBeUndefined();
  });
});

describe('gestão: escolha do tipo no cadastro', () => {
  it('loja nova: a primeira resposta é a pergunta, com enquete, sem chamar a IA', async () => {
    const cenario = criarCenario();

    const respostas = await cenario.enviar('oi');

    expect(textos(respostas)).toContain('o que você vai vender?');
    expect(enquetes(respostas)).toEqual([{ enquete: { pergunta: 'O que você vai vender pelo ZapMenu?', opcoes: [OPCAO_CARDAPIO, OPCAO_LOJA] } }]);
    expect(cenario.entradas).toHaveLength(0);
  });

  it('enquanto não escolhe, nada passa para a IA', async () => {
    const cenario = criarCenario();
    await cenario.enviar('oi');

    const respostas = await cenario.enviar('quero cadastrar minha loja, nome Moda da Ana');

    expect(enquetes(respostas)).toHaveLength(1);
    expect(cenario.entradas).toHaveLength(0);
    expect(cenario.gestaoRepo.snapshot.segmento).toBeUndefined();
  });

  it('"2" grava Loja na hora e já segue para o cadastro', async () => {
    const cenario = criarCenario();
    await cenario.enviar('oi');

    const texto = textos(await cenario.enviar('2'));

    expect(cenario.gestaoRepo.snapshot.segmento).toBe('VAREJO');
    expect(cenario.gestaoRepo.snapshot.lojaSalva.tipoPendente).toBe(false);
    expect(texto).toContain('Combinado: sua loja é um *Loja* 🛍️');
    expect(texto).toContain('catálogo');
    expect(texto).toContain('Para sua loja entrar no ar ainda faltam alguns dados');
  });

  it('o voto na enquete (texto da opção) grava Cardápio', async () => {
    const cenario = criarCenario();

    await cenario.enviar(OPCAO_CARDAPIO);

    expect(cenario.gestaoRepo.snapshot.segmento).toBe('COMIDA');
  });

  it('loja que já existia não é perguntada', async () => {
    const cenario = criarCenario(false);

    const respostas = await cenario.enviar('oi');

    expect(enquetes(respostas)).toHaveLength(0);
    expect(cenario.entradas).toHaveLength(1);
  });
});

describe('gestão: cada tipo fechado na sua caixa', () => {
  const ia = (operacoes: RespostaConversa['operacoes']): RespostaConversa => ({
    resposta: 'Anotei!',
    operacoes,
    operacoesMalformadas: [],
    finalizou: false,
    mostrarCardapio: false,
  });

  it('cardápio: a IA recebe o tipo, e grade ou frete que ela proponha são recusados com explicação', async () => {
    const cenario = criarCenario(false, 'COMIDA', [
      ia([
        { tipo: 'NOVO_ITEM', ref: 'n1', dados: { nome: 'Pizza', precoBase: 40 } },
        { tipo: 'DEFINIR_GRADE', ref: 'n1', grade: [{ tamanho: 'G', estoque: 3 }] },
        { tipo: 'ATUALIZAR_LOJA', dados: { aceitaEnvio: true, freteEnvio: 20 } },
      ]),
    ]);

    const texto = textos(await cenario.enviar('pizza 40, tamanho G com 3 unidades e envio por 20'));

    expect(cenario.entradas[0]?.segmento).toBe('COMIDA');
    expect(texto).toContain(AVISO_SO_DA_LOJA);
    const { rascunho } = cenario.conversa().contexto;
    expect(rascunho.novosItens).toEqual([{ ref: 'n1', nome: 'Pizza', precoBase: 40 }]);
    expect(rascunho.loja).toBeUndefined();
  });

  it('loja: aceita produto com grade e recusa adicionais', async () => {
    const cenario = criarCenario(false, 'VAREJO', [
      ia([
        {
          tipo: 'NOVO_ITEM',
          ref: 'n1',
          dados: { nome: 'Camiseta', precoBase: 59.9, variacoes: [{ nome: 'Extra', opcoes: [{ nome: 'Bordado', precoAdicional: 10 }] }] },
        },
        { tipo: 'DEFINIR_GRADE', ref: 'n1', grade: [{ tamanho: 'P', cor: 'Azul', estoque: 4 }] },
      ]),
    ]);

    const texto = textos(await cenario.enviar('camiseta 59,90, P azul 4, com bordado +10'));

    expect(cenario.entradas[0]?.segmento).toBe('VAREJO');
    expect(texto).toContain(AVISO_SO_DO_CARDAPIO);
    expect(cenario.conversa().contexto.rascunho.novosItens).toEqual([
      { ref: 'n1', nome: 'Camiseta', precoBase: 59.9, grade: [{ tamanho: 'P', cor: 'Azul', estoque: 4 }] },
    ]);
  });

  it('loja: o robô fala em catálogo', async () => {
    const cenario = criarCenario(false, 'VAREJO');

    const texto = textos(await cenario.enviar('catálogo'));

    expect(texto).toContain('Seu catálogo ainda está vazio');
    expect(texto).not.toContain('cardápio');
  });
});
