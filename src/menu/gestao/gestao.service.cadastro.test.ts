import { describe, expect, it } from 'vitest';
import type { ConversaPersistida, ConversationRepository } from '../conversation/conversation.repository.js';
import { contextoInicial, type DadosLoja, type EnderecoVerificado } from '../conversation/conversation-state.types.js';
import { criarGestaoRepositoryFake, type GestaoRepositoryFake } from './__mocks__/gestao.repository.fake.js';
import { criarCadastroPorLista } from './cadastro-empreendedores.js';
import { processarMensagemGestao, type GestaoDeps } from './gestao.service.js';
import type { EntradaConversa, InterpretadorMensagem, Operacao, RespostaConversa } from './interpretador.js';

const TELEFONE = '5581999990000';

const ENDERECO: EnderecoVerificado = {
  numero: '450',
  enderecoFormatado: 'Av. Brasil, 450 - Centro, Campinas - SP',
  latitude: -22.9,
  longitude: -47.06,
  precisao: 'ROOFTOP',
};

const LOJA_QUASE_PRONTA: DadosLoja = {
  nome: 'Pizzaria do Zé',
  aceitaRetirada: true,
  fazEntrega: false,
  enderecoVerificado: ENDERECO,
};

function resposta(parcial: Partial<RespostaConversa> = {}): RespostaConversa {
  return { resposta: '', operacoes: [], operacoesMalformadas: [], finalizou: false, mostrarCardapio: false, ...parcial };
}

function criarCenario(loja: DadosLoja, lojaSalva: Partial<GestaoRepositoryFake['snapshot']['lojaSalva']> = {}) {
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
    loja,
    lojaSalva: { existe: true, temLogo: false, temCapa: false, naoLembrarOpcionais: false, ...lojaSalva },
  });
  const roteiro: RespostaConversa[] = [];
  const entradas: EntradaConversa[] = [];
  const interpretador: InterpretadorMensagem = {
    async conversar(entrada) {
      entradas.push(entrada);
      return roteiro.shift() ?? resposta({ resposta: 'Oi!' });
    },
  };
  const deps: GestaoDeps = {
    conversationRepo,
    gestaoRepo,
    interpretador,
    cadastro: criarCadastroPorLista([]),
    urlDoCardapio: (slug) => `https://zapmenu.test/${slug}`,
  };
  const enviar = async (texto: string, imagemUrl?: string) =>
    (await processarMensagemGestao({ telefone: TELEFONE, texto, imagemUrl }, deps)).join('\n---\n');
  return { gestaoRepo, roteiro, entradas, enviar };
}

const HORARIOS: Operacao = {
  tipo: 'ATUALIZAR_LOJA',
  dados: { horarios: [{ dia: 'seg', abre: '18:00', fecha: '23:00' }] },
};

describe('gestão: cadastro inicial da loja', () => {
  it('no começo da conversa mostra o que falta e passa as pendências para a IA', async () => {
    const cenario = criarCenario(LOJA_QUASE_PRONTA);

    const texto = await cenario.enviar('oi');

    expect(texto).toContain('Para sua loja entrar no ar ainda faltam alguns dados');
    expect(texto).toContain('(4 de 5)');
    expect(texto).toContain('⬜ Horário de funcionamento');
    expect(cenario.entradas[0]?.cadastroPendente).toEqual([
      'Horário de funcionamento: Quais dias e horários a loja funciona? Ex.: terça a domingo, 18h às 23h',
    ]);
  });

  it('"o que falta?" mostra a lista e pede o próximo dado, sem chamar a IA', async () => {
    const cenario = criarCenario({});

    const texto = await cenario.enviar('O que falta?');

    expect(texto).toContain('📋 *Cadastro da loja* (0 de 5)');
    expect(texto).toContain('Vamos lá: Qual é o nome da sua loja?');
    expect(cenario.entradas).toHaveLength(0);
  });

  it('ao completar o cadastro: comemora com o link, pede os itens e lista os opcionais', async () => {
    const cenario = criarCenario(LOJA_QUASE_PRONTA);
    cenario.roteiro.push(resposta({ operacoes: [HORARIOS], finalizou: true }));
    await cenario.enviar('abro segunda das 18h às 23h, é isso');

    const texto = await cenario.enviar('sim');

    expect(texto).toContain('🎉 *Sua loja está no ar!*');
    expect(texto).toContain('Link do cardápio para divulgar: https://zapmenu.test/');
    expect(texto).toContain('me mande os itens do cardápio');
    expect(texto).toContain('• Logo — mande a foto do logo dizendo que é o logo');
    expect(texto).toContain('Pagamento na entrega (dinheiro ou cartão) está *ligado*');
    expect(cenario.gestaoRepo.snapshot.lojaSalva.lembreteOpcionaisEm).toBeInstanceOf(Date);
  });

  it('salvar sem completar mostra o que ainda falta', async () => {
    const cenario = criarCenario({});
    cenario.roteiro.push(resposta({ operacoes: [{ tipo: 'ATUALIZAR_LOJA', dados: { nome: 'Bolos da Ana' } }], finalizou: true }));
    await cenario.enviar('a loja se chama Bolos da Ana, é isso');

    const texto = await cenario.enviar('sim');

    expect(texto).toContain('Para a loja entrar no ar ainda falta');
    expect(texto).toContain('✅ Nome da loja');
    expect(texto).not.toContain('Sua loja está no ar');
  });
});

describe('gestão: lembrete dos dados opcionais', () => {
  const COMPLETA: DadosLoja = { ...LOJA_QUASE_PRONTA, horarios: [{ dia: 'seg', abre: '18:00', fecha: '23:00' }] };

  it('lembra no começo da conversa e não repete na mesma semana', async () => {
    const cenario = criarCenario(COMPLETA);

    expect(await cenario.enviar('oi')).toContain('Para sua loja ficar mais completa');
    await cenario.enviar('cancelar');
    expect(await cenario.enviar('oi de novo')).not.toContain('Para sua loja ficar mais completa');
  });

  it('volta a lembrar depois de uma semana', async () => {
    const oitoDias = new Date(Date.now() - 8 * 24 * 60 * 60_000);
    const cenario = criarCenario(COMPLETA, { lembreteOpcionaisEm: oitoDias });

    expect(await cenario.enviar('oi')).toContain('Para sua loja ficar mais completa');
  });

  it('"não lembrar mais" desliga o lembrete', async () => {
    const cenario = criarCenario(COMPLETA);

    expect(await cenario.enviar('não lembrar mais')).toContain('não lembro mais');
    expect(cenario.gestaoRepo.snapshot.lojaSalva.naoLembrarOpcionais).toBe(true);
    expect(await cenario.enviar('oi')).not.toContain('Para sua loja ficar mais completa');
  });

  it('não lembra quando os opcionais estão completos', async () => {
    const cenario = criarCenario(
      { ...COMPLETA, descricao: 'Pizzas', corDestaque: '#C2410C', pedidoMinimo: 30 },
      { temLogo: true, temCapa: true },
    );

    expect(await cenario.enviar('oi')).not.toContain('Para sua loja ficar mais completa');
  });

  it('foto mandada como logo entra no rascunho da loja', async () => {
    const cenario = criarCenario(COMPLETA, { naoLembrarOpcionais: true });
    cenario.roteiro.push(resposta({ operacoes: [{ tipo: 'ANEXAR_FOTO_LOJA', destino: 'LOGO' }], finalizou: true }));

    const texto = await cenario.enviar('essa é a logo', 'data:image/png;base64,AAA');

    expect(texto).toContain('🖼️ Logo nova 📷');
  });
});
