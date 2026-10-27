import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversaPersistida, ConversationRepository } from '../../menu/conversation/conversation.repository.js';
import { contextoInicial } from '../../menu/conversation/conversation-state.types.js';
import { criarGestaoRepositoryFake } from '../../menu/gestao/__mocks__/gestao.repository.fake.js';
import { criarInterpretadorRoteiroFake } from '../../menu/gestao/__mocks__/interpretador.roteiro.fake.js';
import { criarCadastroPorLista } from '../../menu/gestao/cadastro-empreendedores.js';
import { criarIdempotencyRepositoryFake } from '../../shared/idempotency/__mocks__/idempotency.repository.fake.js';
import { criarWhatsAppClientFake } from '../__mocks__/whatsapp-client.fake.js';
import { registrarMenuInboundRouter } from './menu-inbound.router.js';

const TELEFONE = '5581999990000';

function cenario() {
  let conversa: ConversaPersistida = { telefone: TELEFONE, estado: 'OCIOSO', contexto: contextoInicial() };
  const conversationRepo: ConversationRepository = {
    async obterOuCriar() {
      return structuredClone(conversa);
    },
    async salvar(nova) {
      conversa = structuredClone(nova);
    },
  };
  const ia = criarInterpretadorRoteiroFake();
  const whatsapp = criarWhatsAppClientFake();
  const idempotency = criarIdempotencyRepositoryFake();
  registrarMenuInboundRouter({
    conversationRepo,
    gestaoRepo: criarGestaoRepositoryFake({
      loja: { nome: 'Pizzaria do Zé' },
      lojaSalva: { existe: true, temLogo: false, temCapa: false, naoLembrarOpcionais: true },
    }),
    interpretador: ia,
    cadastro: criarCadastroPorLista([]),
    whatsapp: whatsapp.client,
    idempotency,
    agrupamento: { silencioMs: 3_000, maximoMs: 10_000 },
  });
  let id = 0;
  const mandar = (corpo: string, imagemUrl?: string) =>
    whatsapp.emitirMensagem({ id: `m${++id}`, telefone: TELEFONE, corpo, imagemUrl, timestamp: new Date() });
  const textos = () => whatsapp.mensagensEnviadas.map((mensagem) => mensagem.conteudo);
  return { ia, whatsapp, idempotency, mandar, textos };
}

describe('gestão: mensagens seguidas viram uma rodada só', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('espera 3 s de silêncio (reiniciando a cada mensagem) e chama a IA uma vez com tudo', async () => {
    const { ia, whatsapp, idempotency, mandar, textos } = cenario();
    ia.responder({ resposta: 'Anotei a pizza de calabresa por R$ 40!' });

    await mandar('entrou pizza');
    await vi.advanceTimersByTimeAsync(2_000);
    await mandar('de calabresa');
    await vi.advanceTimersByTimeAsync(2_000);
    await mandar('40 reais');
    await vi.advanceTimersByTimeAsync(2_900);
    expect(ia.entradas).toHaveLength(0);
    expect(whatsapp.digitando).toEqual([TELEFONE, TELEFONE, TELEFONE]);

    await vi.advanceTimersByTimeAsync(200);
    expect(ia.entradas).toHaveLength(1);
    expect(ia.entradas[0]!.mensagem).toBe('entrou pizza\nde calabresa\n40 reais');
    expect(textos()).toContain('Anotei a pizza de calabresa por R$ 40!');
    for (const id of ['m1', 'm2', 'm3']) {
      expect(await idempotency.jaProcessado('whatsapp_menu', id)).toBe(true);
    }
  });

  it('não espera mais que 10 s desde a primeira mensagem', async () => {
    const { ia, mandar } = cenario();
    ia.responder({ resposta: 'ok' });
    for (let i = 0; i < 6; i++) {
      await mandar(`parte ${i}`);
      await vi.advanceTimersByTimeAsync(2_000);
    }
    expect(ia.entradas).toHaveLength(1);
    expect(ia.entradas[0]!.mensagem).toBe('parte 0\nparte 1\nparte 2\nparte 3\nparte 4');
  });

  it('a foto no meio entra na mesma rodada', async () => {
    const { ia, mandar } = cenario();
    ia.responder({ resposta: 'ok' });
    await mandar('essa é a calabresa');
    await mandar('', 'data:image/jpeg;base64,AAA');
    await mandar('custa 40');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(ia.entradas).toHaveLength(1);
    expect(ia.entradas[0]).toMatchObject({ mensagem: 'essa é a calabresa\ncusta 40', fotoRecebida: true });
  });

  it('comando curto sozinho responde na hora, sem esperar', async () => {
    const { ia, mandar, textos } = cenario();
    await mandar('o que falta?');
    expect(textos().join('\n')).toContain('Horário de funcionamento');
    expect(ia.entradas).toHaveLength(0);
  });
});
