import { describe, expect, it } from 'vitest';
import type { ConversaPersistida, ConversationRepository } from '../conversation/conversation.repository.js';
import { contextoInicial } from '../conversation/conversation-state.types.js';
import { criarGestaoRepositoryFake } from './__mocks__/gestao.repository.fake.js';
import { criarCadastroPorLista } from './cadastro-empreendedores.js';
import { AVISO_FIM_DO_FRETE_FIXO, processarMensagemGestao, type GestaoDeps, type RespostaGestao } from './gestao.service.js';
import type { EntradaConversa, InterpretadorMensagem, RespostaConversa } from './interpretador.js';
import { AVISO_SO_DA_LOJA, AVISO_SO_DO_CARDAPIO } from './permissoes-por-tipo.js';
import { interpretarRespostaDaIA, montarEntrada } from './deepseek-interpretador.js';
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
  return { gestaoRepo, entradas, enviar, deps, conversa: () => conversa };
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
        { tipo: 'ATUALIZAR_LOJA', dados: { usaMelhorEnvio: true } },
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

describe('gestão: mudar tipo da loja', () => {
  it('pergunta o tipo, explica o que muda, e só troca com o sim', async () => {
    const cenario = criarCenario(false, 'COMIDA');

    const pergunta = await cenario.enviar('mudar tipo da loja');
    expect(textos(pergunta)).toContain('Hoje sua loja é *Cardápio*');
    expect(enquetes(pergunta)).toHaveLength(1);

    const aviso = textos(await cenario.enviar(OPCAO_LOJA));
    expect(aviso).toContain('os adicionais (variações com preço) deixam de aparecer');
    expect(aviso).toContain('Nada é apagado');
    expect(cenario.gestaoRepo.snapshot.segmento).toBe('COMIDA');

    const feito = textos(await cenario.enviar('sim'));
    expect(feito).toContain('Sua loja agora é *Loja*');
    expect(feito).toContain('catálogo');
    expect(cenario.gestaoRepo.snapshot.segmento).toBe('VAREJO');
    expect(cenario.entradas).toHaveLength(0);
  });

  it('"não" na confirmação mantém o tipo', async () => {
    const cenario = criarCenario(false, 'VAREJO');
    await cenario.enviar('trocar o tipo da loja');
    const aviso = textos(await cenario.enviar('1'));
    expect(aviso).toContain('tamanhos e cores com estoque');

    const texto = textos(await cenario.enviar('não'));

    expect(texto).toContain('continua como *Loja*');
    expect(cenario.gestaoRepo.snapshot.segmento).toBe('VAREJO');
    expect(cenario.conversa().contexto.trocaDeTipo).toBeUndefined();
  });

  it('escolher o mesmo tipo não muda nada', async () => {
    const cenario = criarCenario(false, 'VAREJO');
    await cenario.enviar('mudar tipo');

    expect(textos(await cenario.enviar('2'))).toContain('Sua loja já é *Loja*');
  });

  it('com alterações anotadas, pede para salvar ou descartar antes', async () => {
    const cenario = criarCenario(false, 'COMIDA', [
      { resposta: 'Anotei!', operacoes: [{ tipo: 'NOVO_ITEM', ref: 'n1', dados: { nome: 'Pizza', precoBase: 40 } }], operacoesMalformadas: [], finalizou: false, mostrarCardapio: false },
    ]);
    await cenario.enviar('pizza 40');

    const texto = textos(await cenario.enviar('mudar tipo da loja'));

    expect(texto).toContain('Antes de trocar o tipo da loja');
    expect(cenario.conversa().contexto.trocaDeTipo).toBeUndefined();
  });
});

describe('gestão: fotos dos produtos da loja', () => {
  const FOTO_AZUL = 'data:image/jpeg;base64,AZUL';
  const FOTO_COSTAS = 'data:image/jpeg;base64,COSTAS';
  const anexar = (cor?: string): RespostaConversa => ({
    resposta: 'Foto anotada!',
    operacoes: [
      { tipo: 'NOVO_ITEM', ref: 'n1', dados: { nome: 'Camiseta', precoBase: 59.9 } },
      { tipo: 'ANEXAR_FOTO', ref: 'n1', cor },
    ],
    operacoesMalformadas: [],
    finalizou: false,
    mostrarCardapio: false,
  });

  it('a legenda com cor liga a foto à cor, e as fotos seguintes sem legenda vão para a mesma galeria sem IA', async () => {
    const cenario = criarCenario(false, 'VAREJO', [anexar('Azul')]);
    const enviarFoto = (texto: string, imagemUrl: string) =>
      processarMensagemGestao({ telefone: TELEFONE, texto, imagemUrl }, cenario.deps);

    await enviarFoto('camiseta 59,90, essa é a azul', FOTO_AZUL);
    const texto = textos(await enviarFoto('', FOTO_COSTAS));

    expect(cenario.entradas).toHaveLength(1);
    expect(texto).toContain('Mais uma foto de *Camiseta* anotada (2 fotos)');
    const [camiseta] = cenario.conversa().contexto.rascunho.novosItens;
    expect(camiseta?.fotos).toEqual([{ url: FOTO_AZUL, cor: 'Azul' }, { url: FOTO_COSTAS }]);
    expect(camiseta?.imagemUrl).toBe(FOTO_AZUL);
  });

  it('a IA nunca recebe as fotos em base64, só quantas são e de que cor', async () => {
    const cenario = criarCenario(false, 'VAREJO', [anexar('Azul'), anexar()]);
    await processarMensagemGestao({ telefone: TELEFONE, texto: 'camiseta azul', imagemUrl: FOTO_AZUL }, cenario.deps);
    await processarMensagemGestao({ telefone: TELEFONE, texto: 'quanto custa?' }, cenario.deps);

    const entrada = JSON.stringify(montarEntrada(cenario.entradas[1]!));

    expect(entrada).not.toContain('base64');
    expect(entrada).toContain('"fotos":[{"cor":"Azul"}]');
  });

  it('no cardápio, foto sem legenda continua indo para a IA e troca a foto única', async () => {
    const cenario = criarCenario(false, 'COMIDA', [anexar(), anexar()]);
    await processarMensagemGestao({ telefone: TELEFONE, texto: 'pizza', imagemUrl: FOTO_AZUL }, cenario.deps);

    await processarMensagemGestao({ telefone: TELEFONE, texto: '', imagemUrl: FOTO_COSTAS }, cenario.deps);

    expect(cenario.entradas).toHaveLength(2);
    expect(cenario.conversa().contexto.rascunho.novosItens.at(-1)?.fotos).toBeUndefined();
  });
});

describe('gestão: política de troca pela conversa', () => {
  const politica = (): RespostaConversa => ({
    resposta: 'Anotei a política de troca!',
    operacoes: [{ tipo: 'ATUALIZAR_LOJA', dados: { politicaTroca: 'Troca em até 7 dias, com a etiqueta.' } }],
    operacoesMalformadas: [],
    finalizou: true,
    mostrarCardapio: false,
  });

  it('na loja, entra no resumo e é salva', async () => {
    const cenario = criarCenario(false, 'VAREJO', [politica()]);

    const resumo = textos(await cenario.enviar('troco em 7 dias com etiqueta, é isso'));
    await cenario.enviar('sim');

    expect(resumo).toContain('🔁 Política de troca: _Troca em até 7 dias, com a etiqueta._');
    expect(cenario.gestaoRepo.salvos.at(-1)?.rascunho.loja?.politicaTroca).toBe('Troca em até 7 dias, com a etiqueta.');
  });

  it('no cardápio, é recusada', async () => {
    const cenario = criarCenario(false, 'COMIDA', [politica()]);

    const texto = textos(await cenario.enviar('troco em 7 dias'));

    expect(texto).toContain(AVISO_SO_DA_LOJA);
    expect(cenario.conversa().contexto.rascunho.loja).toBeUndefined();
  });

  it('a IA entende politica_troca', async () => {
    const saida = interpretarRespostaDaIA(
      JSON.stringify({ operacoes: [{ tipo: 'atualizar_loja', politica_troca: ' Troca em 7 dias. ' }] }),
    );
    expect(saida.operacoes[0]).toMatchObject({ dados: { politicaTroca: 'Troca em 7 dias.' } });
  });
});

describe('gestão: Instagram da loja (opcional)', () => {
  it('normaliza o @, entra no resumo e é salvo', async () => {
    const cenario = criarCenario(false, 'COMIDA', [
      { resposta: 'Anotei!', operacoes: [{ tipo: 'ATUALIZAR_LOJA', dados: { instagram: 'https://instagram.com/PizzariaDoZe/' } }], operacoesMalformadas: [], finalizou: true, mostrarCardapio: false },
    ]);

    const resumo = textos(await cenario.enviar('nosso insta é instagram.com/PizzariaDoZe, é isso'));
    await cenario.enviar('sim');

    expect(resumo).toContain('📸 Instagram: *@pizzariadoze*');
    expect(cenario.gestaoRepo.salvos.at(-1)?.rascunho.loja?.instagram).toBe('pizzariadoze');
  });

  it('perfil inválido vira aviso e não é anotado', async () => {
    const cenario = criarCenario(false, 'VAREJO', [
      { resposta: 'Anotei!', operacoes: [{ tipo: 'ATUALIZAR_LOJA', dados: { instagram: 'moda da ana' } }], operacoesMalformadas: [], finalizou: false, mostrarCardapio: false },
    ]);

    const texto = textos(await cenario.enviar('o insta é moda da ana'));

    expect(texto).toContain('Não reconheci "moda da ana" como perfil do Instagram');
    expect(cenario.conversa().contexto.rascunho.loja?.instagram).toBeUndefined();
  });
});

describe('gestão: fim do frete fixo por região', () => {
  it('a loja que usava recebe o aviso uma vez', async () => {
    const cenario = criarCenario(false, 'VAREJO', [
      { resposta: 'Oi!', operacoes: [], operacoesMalformadas: [], finalizou: false, mostrarCardapio: false },
      { resposta: 'Oi de novo!', operacoes: [], operacoesMalformadas: [], finalizou: false, mostrarCardapio: false },
    ]);
    cenario.gestaoRepo.snapshot.lojaSalva.avisarFimDoFreteFixo = true;

    expect(textos(await cenario.enviar('oi'))).toContain(AVISO_FIM_DO_FRETE_FIXO);
    expect(textos(await cenario.enviar('oi'))).not.toContain(AVISO_FIM_DO_FRETE_FIXO);
  });
});
