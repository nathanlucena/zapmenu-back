import { describe, expect, it, vi } from 'vitest';
import type { ConversaPersistida, ConversationRepository } from '../conversation/conversation.repository.js';
import { contextoInicial } from '../conversation/conversation-state.types.js';
import { criarGestaoRepositoryFake } from './__mocks__/gestao.repository.fake.js';
import { criarPreviasRepositoryFake } from './__mocks__/previas.repository.fake.js';
import { criarCadastroPorLista } from './cadastro-empreendedores.js';
import { processarMensagemGestao, type GestaoDeps } from './gestao.service.js';
import type { InterpretadorMensagem, RespostaConversa } from './interpretador.js';
import { criarWhatsAppClientFake } from '../../whatsapp/__mocks__/whatsapp-client.fake.js';
import { criarIdempotencyRepositoryFake } from '../../shared/idempotency/__mocks__/idempotency.repository.fake.js';
import { registrarMenuInboundRouter } from '../../whatsapp/menu-session/menu-inbound.router.js';

const TELEFONE = '5581999990000';
const LOJA_COMPLETA = {
  nome: 'Pizzaria do Zé',
  aceitaRetirada: true,
  enderecoVerificado: { numero: '1', enderecoFormatado: 'Rua A, 1', latitude: 0, longitude: 0, precisao: 'ROOFTOP' },
  horarios: [{ dia: 'seg' as const, abre: '18:00', fecha: '23:00' }],
};

function resposta(parcial: Partial<RespostaConversa> = {}): RespostaConversa {
  return {
    resposta: '',
    operacoes: [],
    operacoesMalformadas: [],
    finalizou: false,
    mostrarCardapio: false,
    ...parcial,
  };
}

const NOVA_PIZZA = resposta({
  operacoes: [{ tipo: 'NOVO_ITEM', ref: 'n1', dados: { nome: 'Calabresa', precoBase: 50 } }],
  finalizou: true,
});

function criarDeps() {
  let conversa: ConversaPersistida = { telefone: TELEFONE, estado: 'OCIOSO', contexto: contextoInicial() };
  const conversationRepo: ConversationRepository = {
    async obterOuCriar() {
      return structuredClone(conversa);
    },
    async salvar(nova) {
      conversa = structuredClone(nova);
    },
  };
  const roteiro: RespostaConversa[] = [];
  const interpretador: InterpretadorMensagem = { conversar: async () => roteiro.shift() ?? resposta() };
  const previas = criarPreviasRepositoryFake();
  const deps: GestaoDeps = {
    conversationRepo,
    gestaoRepo: criarGestaoRepositoryFake({
      loja: LOJA_COMPLETA,
      lojaSalva: { existe: true, temLogo: false, temCapa: false, naoLembrarOpcionais: true },
    }),
    interpretador,
    cadastro: criarCadastroPorLista([]),
    previas: { repo: previas, urlDaImagem: (id) => `http://front.test/api/previa/${id}` },
  };
  return { deps, roteiro, previas };
}

describe('gestão: prévia em imagem junto com o resumo', () => {
  it('manda a imagem da prévia antes do resumo, com a prévia guardada', async () => {
    const { deps, roteiro, previas } = criarDeps();
    roteiro.push(NOVA_PIZZA);

    const respostas = await processarMensagemGestao({ telefone: TELEFONE, texto: 'pizza calabresa 50, é isso' }, deps);

    expect(respostas[0]).toEqual({
      imagemUrl: 'http://front.test/api/previa/previa-1',
      legenda: 'Assim vai ficar no cardápio 👇',
    });
    expect(respostas[1]).toContain('Vou salvar estas alterações');
    expect(previas.guardadas.get('previa-1')?.itens[0]).toMatchObject({ nome: 'Calabresa', marca: 'NOVO' });
  });

  it('sem conseguir guardar a prévia, vai só o resumo', async () => {
    const { deps, roteiro, previas } = criarDeps();
    previas.guardar = async () => {
      throw new Error('banco caiu');
    };
    roteiro.push(NOVA_PIZZA);

    const respostas = await processarMensagemGestao({ telefone: TELEFONE, texto: 'pizza calabresa 50, é isso' }, deps);

    expect(respostas).toHaveLength(1);
    expect(respostas[0]).toContain('Vou salvar estas alterações');
  });

  it('no WhatsApp, imagem que falha ou demora não segura o resumo', async () => {
    vi.useFakeTimers();
    try {
      const { deps, roteiro } = criarDeps();
      roteiro.push(NOVA_PIZZA);
      const whatsapp = criarWhatsAppClientFake();
      whatsapp.client.sendImage = () => new Promise(() => undefined); // nunca termina
      registrarMenuInboundRouter({ ...deps, whatsapp: whatsapp.client, idempotency: criarIdempotencyRepositoryFake() });

      const entrega = whatsapp.emitirMensagem({
        id: 'm1',
        telefone: TELEFONE,
        corpo: 'pizza calabresa 50, é isso',
        timestamp: new Date(),
      });
      await vi.advanceTimersByTimeAsync(8_000);
      await entrega;

      expect(whatsapp.mensagensEnviadas.map((m) => m.conteudo)).toEqual([
        expect.stringContaining('Vou salvar estas alterações'),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
