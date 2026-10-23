import { describe, expect, it } from 'vitest';
import type { ConversaPersistida, ConversationRepository } from '../../menu/conversation/conversation.repository.js';
import { contextoInicial } from '../../menu/conversation/conversation-state.types.js';
import { criarGestaoRepositoryFake } from '../../menu/gestao/__mocks__/gestao.repository.fake.js';
import { criarCadastroPorLista } from '../../menu/gestao/cadastro-empreendedores.js';
import { OPCAO_LOJA } from '../../menu/gestao/tipo-da-loja.js';
import { criarIdempotencyRepositoryFake } from '../../shared/idempotency/__mocks__/idempotency.repository.fake.js';
import { criarWhatsAppClientFake } from '../__mocks__/whatsapp-client.fake.js';
import { registrarMenuInboundRouter } from './menu-inbound.router.js';

const TELEFONE = '5581999990000';

function montar() {
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
    lojaSalva: { existe: false, temLogo: false, temCapa: false, naoLembrarOpcionais: false, tipoPendente: true },
  });
  const whatsapp = criarWhatsAppClientFake();
  registrarMenuInboundRouter({
    conversationRepo,
    gestaoRepo,
    cadastro: criarCadastroPorLista([]),
    whatsapp: whatsapp.client,
    idempotency: criarIdempotencyRepositoryFake(),
  });
  return { whatsapp, gestaoRepo };
}

describe('roteador da gestão: tipo da loja', () => {
  it('manda a enquete do tipo e grava a escolha quando a pessoa vota', async () => {
    const { whatsapp, gestaoRepo } = montar();

    await whatsapp.emitirMensagem({ id: 'm1', telefone: TELEFONE, corpo: 'oi', timestamp: new Date() });
    const enquete = whatsapp.mensagensEnviadas.find((mensagem) => mensagem.tipo === 'enquete');
    expect(enquete?.opcoes).toHaveLength(2);

    await whatsapp.emitirVoto({ id: 'v1', telefone: TELEFONE, enqueteId: enquete!.enqueteId!, opcoes: [OPCAO_LOJA] });
    // O mesmo voto entregue de novo não processa duas vezes.
    await whatsapp.emitirVoto({ id: 'v1', telefone: TELEFONE, enqueteId: enquete!.enqueteId!, opcoes: [OPCAO_LOJA] });

    expect(gestaoRepo.snapshot.segmento).toBe('VAREJO');
    expect(whatsapp.mensagensEnviadas.filter((mensagem) => mensagem.conteudo.includes('Combinado'))).toHaveLength(1);
  });

  it('ignora votos em outras enquetes (pedidos)', async () => {
    const { whatsapp, gestaoRepo } = montar();

    await whatsapp.emitirVoto({ id: 'v2', telefone: TELEFONE, enqueteId: 'enquete-x', opcoes: ['Aceitar'] });

    expect(whatsapp.mensagensEnviadas).toEqual([]);
    expect(gestaoRepo.snapshot.segmento).toBeUndefined();
  });
});
