import { beforeEach, describe, expect, it } from 'vitest';
import type { ConversaPersistida, ConversationRepository } from '../conversation/conversation.repository.js';
import { contextoInicial, type DadosLoja, type Rascunho } from '../conversation/conversation-state.types.js';
import { criarEnderecoFake, type EnderecoFake } from '../endereco/__mocks__/endereco.fake.js';
import type { GestaoRepository, SnapshotCardapio } from './gestao.repository.js';
import { processarMensagemGestao, type GestaoDeps } from './gestao.service.js';
import type { InterpretadorMensagem, Operacao, RespostaConversa } from './interpretador.js';
import { criarCadastroPorLista } from './cadastro-empreendedores.js';

const TELEFONE = '5581999990000';

function resposta(parcial: Partial<RespostaConversa> = {}): RespostaConversa {
  return { resposta: '', operacoes: [], operacoesMalformadas: [], finalizou: false, mostrarCardapio: false, ...parcial };
}

interface Cenario {
  deps: GestaoDeps;
  roteiro: RespostaConversa[];
  salvos: Rascunho[];
  conversa: () => ConversaPersistida;
  endereco: EnderecoFake;
  enviar: (texto: string) => Promise<string>;
}

function criarCenario(loja: DadosLoja = {}, opcoes: { semEndereco?: boolean } = {}): Cenario {
  let conversa: ConversaPersistida = { telefone: TELEFONE, estado: 'OCIOSO', contexto: contextoInicial() };
  const roteiro: RespostaConversa[] = [];
  const salvos: Rascunho[] = [];
  const snapshot: SnapshotCardapio = {
    cardapioId: 'c1',
    categorias: [],
    itens: [{ id: 'i1', nome: 'Coca 2L', precoBase: 14, ativo: true, temFoto: false, variacoes: [] }],
    loja,
    lojaSalva: { existe: true, temLogo: false, temCapa: false, naoLembrarOpcionais: true },
  };

  const conversationRepo: ConversationRepository = {
    async obterOuCriar() {
      return structuredClone(conversa);
    },
    async salvar(nova) {
      conversa = structuredClone(nova);
    },
  };
  const gestaoRepo: GestaoRepository = {
    async carregarSnapshot() {
      return structuredClone(snapshot);
    },
    async salvarRascunho(_id, rascunho) {
      salvos.push(structuredClone(rascunho));
    },
    async registrarLembreteOpcionais() {},
  };
  const interpretador: InterpretadorMensagem = {
    async conversar() {
      const proxima = roteiro.shift();
      if (!proxima) {
        throw new Error('roteiro da IA acabou');
      }
      return proxima;
    },
  };
  const endereco = criarEnderecoFake();
  const deps: GestaoDeps = {
    conversationRepo,
    gestaoRepo,
    interpretador,
    endereco: opcoes.semEndereco ? undefined : endereco,
    cadastro: criarCadastroPorLista([]),
  };

  return {
    deps,
    roteiro,
    salvos,
    conversa: () => conversa,
    endereco,
    enviar: async (texto) => (await processarMensagemGestao({ telefone: TELEFONE, texto }, deps)).join('\n---\n'),
  };
}

const DEFINIR_AURORA: Operacao = { tipo: 'DEFINIR_ENDERECO', dados: { cep: '50050-000', numero: '123' } };
const FAIXAS_EXEMPLO: Operacao = {
  tipo: 'ATUALIZAR_LOJA',
  dados: {
    faixasEntrega: [
      { ateKm: 3, taxa: 5 },
      { ateKm: 1, taxa: 0 },
    ],
  },
};

describe('gestão: endereço e entrega por distância', () => {
  let cenario: Cenario;
  beforeEach(() => {
    cenario = criarCenario();
  });

  it('fluxo completo: CEP + número, confirmação, faixas, resumo e gravação', async () => {
    cenario.roteiro.push(
      resposta({
        resposta: 'Vou procurar 🔎',
        operacoes: [{ tipo: 'ATUALIZAR_LOJA', dados: { fazEntrega: true } }, DEFINIR_AURORA],
      }),
    );
    const confirmacao = await cenario.enviar('quero entregar. cep 50050-000, 123');
    expect(confirmacao).toContain('Encontrei este endereço');
    expect(confirmacao).toContain('R. da Aurora, 123 - Boa Vista, Recife - PE, 50050-000');
    expect(confirmacao).toContain('https://maps.google.com/?q=-8.059100,-34.879800');
    expect(confirmacao).toContain('É aqui?');

    // "sim" do endereço é tratado sem chamar a IA (o roteiro está vazio).
    const anotado = await cenario.enviar('sim');
    expect(anotado).toContain('Endereço anotado');
    expect(anotado).toContain('como você cobra a entrega');

    cenario.roteiro.push(resposta({ resposta: 'Perfeito!', operacoes: [FAIXAS_EXEMPLO], finalizou: true }));
    const resumo = await cenario.enviar('até 1km grátis, até 3km 5 reais, é isso');
    expect(resumo).toContain('📍 Endereço: *R. da Aurora, 123 - Boa Vista, Recife - PE, 50050-000*');
    expect(resumo).toContain('🛵 Entrega: *até 1 km grátis · até 3 km R$ 5,00 · acima de 3 km não entrega*');
    expect(cenario.conversa().estado).toBe('CONFIRMANDO');

    await cenario.enviar('sim');
    expect(cenario.salvos).toHaveLength(1);
    expect(cenario.salvos[0]!.loja).toMatchObject({
      fazEntrega: true,
      faixasEntrega: [
        { ateKm: 1, taxa: 0 },
        { ateKm: 3, taxa: 5 },
      ],
      enderecoVerificado: { cep: '50050000', numero: '123', latitude: -8.0591, longitude: -34.8798 },
    });
  });

  it('"não" descarta o encontrado e a correção parcial reaproveita o CEP', async () => {
    cenario.roteiro.push(resposta({ operacoes: [DEFINIR_AURORA] }));
    await cenario.enviar('50050-000, 123');

    expect(await cenario.enviar('não')).toContain('só o que estiver errado');
    expect(cenario.conversa().contexto.enderecoPendente).toBeUndefined();

    cenario.roteiro.push(resposta({ operacoes: [{ tipo: 'DEFINIR_ENDERECO', dados: { numero: '132' } }] }));
    await cenario.enviar('o número é 132');
    expect(cenario.endereco.buscasGeo.at(-1)).toBe('Rua da Aurora, 132, Boa Vista, Recife - PE, 50050-000, Brasil');
    expect(cenario.conversa().contexto.enderecoPendente).toBeDefined();
  });

  it('a IA também pode confirmar o endereço com outras palavras', async () => {
    cenario.roteiro.push(resposta({ operacoes: [DEFINIR_AURORA] }));
    await cenario.enviar('50050-000, 123');
    cenario.roteiro.push(resposta({ resposta: 'Anotado!', operacoes: [{ tipo: 'CONFIRMAR_ENDERECO' }] }));
    await cenario.enviar('isso mesmo, é aí');
    expect(cenario.conversa().contexto.rascunho.loja?.enderecoVerificado?.numero).toBe('123');
  });

  it('"é isso" junto com o endereço mostra o "é aqui?" antes do resumo', async () => {
    cenario.roteiro.push(resposta({ operacoes: [DEFINIR_AURORA], finalizou: true }));
    const texto = await cenario.enviar('o endereço é 50050-000, 123, só isso');
    expect(texto).toContain('É aqui?');
    expect(texto).not.toContain('Vou salvar');
    expect(cenario.conversa().estado).toBe('CONVERSANDO');
  });

  it('faixas sem endereço impedem o resumo', async () => {
    cenario.roteiro.push(resposta({ operacoes: [FAIXAS_EXEMPLO], finalizou: true }));
    const texto = await cenario.enviar('até 1km grátis, até 3km 5 reais, é isso');
    expect(texto).toContain('Antes de salvar');
    expect(texto).toContain('o CEP e o número da loja');
    // Configurar faixas liga a entrega.
    expect(cenario.conversa().contexto.rascunho.loja?.fazEntrega).toBe(true);
  });

  it('pede o número quando só veio o CEP', async () => {
    cenario.roteiro.push(resposta({ operacoes: [{ tipo: 'DEFINIR_ENDERECO', dados: { cep: '50050000' } }] }));
    expect(await cenario.enviar('cep 50050000')).toContain('Qual é o número da loja?');
    expect(cenario.endereco.buscasGeo).toHaveLength(0);
  });

  it('CEP com dígitos a menos é avisado sem chamar API', async () => {
    cenario.roteiro.push(resposta({ operacoes: [{ tipo: 'DEFINIR_ENDERECO', dados: { cep: '5005000', numero: '1' } }] }));
    expect(await cenario.enviar('5005000, 1')).toContain('tem 7 dígitos');
  });

  it('sem chave do Google avisa que está indisponível e mantém o rascunho', async () => {
    const semMapa = criarCenario({}, { semEndereco: true });
    semMapa.roteiro.push(
      resposta({ operacoes: [{ tipo: 'ATUALIZAR_LOJA', dados: { nome: 'Pizzaria do Zé' } }, DEFINIR_AURORA] }),
    );
    expect(await semMapa.enviar('nome pizzaria do zé, cep 50050-000, 123')).toContain('serviço de mapas não está configurado');
    expect(semMapa.conversa().contexto.rascunho.loja?.nome).toBe('Pizzaria do Zé');
  });

  it('cancelar descarta o endereço pendente', async () => {
    cenario.roteiro.push(resposta({ operacoes: [DEFINIR_AURORA] }));
    await cenario.enviar('50050-000, 123');
    await cenario.enviar('cancelar');
    expect(cenario.conversa().contexto.enderecoPendente).toBeUndefined();
    expect(cenario.conversa().contexto.consultaEndereco).toBeUndefined();
  });
});

describe('gestão: loja antiga com taxa fixa', () => {
  const lojaAntiga: DadosLoja = { fazEntrega: true, taxaEntrega: 5 };

  it('avisa no começo da conversa que a entrega precisa ser configurada', async () => {
    const cenario = criarCenario(lojaAntiga);
    cenario.roteiro.push(resposta({ resposta: 'Oi!' }));
    expect(await cenario.enviar('oi')).toContain('Agora a entrega é calculada pela distância');
  });

  it('não trava outras alterações', async () => {
    const cenario = criarCenario(lojaAntiga);
    cenario.roteiro.push(
      resposta({ operacoes: [{ tipo: 'EDITAR_ITEM', itemId: 'i1', dados: { precoBase: 15 } }], finalizou: true }),
    );
    const texto = await cenario.enviar('a coca agora é 15, é isso');
    expect(texto).toContain('Vou salvar estas alterações');
    expect(cenario.conversa().estado).toBe('CONFIRMANDO');
  });
});
