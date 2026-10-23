import { describe, expect, it } from 'vitest';
import type { ConversaPersistida, ConversationRepository } from '../conversation/conversation.repository.js';
import { contextoInicial } from '../conversation/conversation-state.types.js';
import { criarGestaoRepositoryFake } from './__mocks__/gestao.repository.fake.js';
import { criarCadastroPorLista } from './cadastro-empreendedores.js';
import { processarMensagemGestao, type GestaoDeps, type RespostaGestao } from './gestao.service.js';
import type { EntradaConversa, InterpretadorMensagem } from './interpretador.js';
import { OPCAO_CARDAPIO, OPCAO_LOJA, tipoDaResposta } from './tipo-da-loja.js';

const TELEFONE = '5581999990000';

/** Loja nova: ainda não escolheu entre cardápio e loja. */
function criarCenario(tipoPendente = true) {
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
    lojaSalva: { existe: false, temLogo: false, temCapa: false, naoLembrarOpcionais: false, tipoPendente },
  });
  const entradas: EntradaConversa[] = [];
  const interpretador: InterpretadorMensagem = {
    async conversar(entrada) {
      entradas.push(entrada);
      return { resposta: 'Oi!', operacoes: [], operacoesMalformadas: [], finalizou: false, mostrarCardapio: false };
    },
  };
  const deps: GestaoDeps = { conversationRepo, gestaoRepo, interpretador, cadastro: criarCadastroPorLista([]) };
  const enviar = (texto: string) => processarMensagemGestao({ telefone: TELEFONE, texto }, deps);
  return { gestaoRepo, entradas, enviar };
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
