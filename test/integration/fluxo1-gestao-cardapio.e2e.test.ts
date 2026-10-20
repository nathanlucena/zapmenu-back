import { describe, expect, it } from 'vitest';
import { criarConversationRepositoryFake } from '../../src/menu/conversation/__mocks__/conversation.repository.fake.js';
import { criarGestaoRepositoryFake } from '../../src/menu/gestao/__mocks__/gestao.repository.fake.js';
import { criarInterpretadorRoteiroFake } from '../../src/menu/gestao/__mocks__/interpretador.roteiro.fake.js';
import { criarCadastroPorLista } from '../../src/menu/gestao/cadastro-empreendedores.js';
import { RESPOSTA_NUMERO_SEM_ACESSO } from '../../src/menu/gestao/gestao.service.js';
import type { Operacao } from '../../src/menu/gestao/interpretador.js';
import { criarIdempotencyRepositoryFake } from '../../src/shared/idempotency/__mocks__/idempotency.repository.fake.js';
import { criarWhatsAppClientFake } from '../../src/whatsapp/__mocks__/whatsapp-client.fake.js';
import { registrarMenuInboundRouter } from '../../src/whatsapp/menu-session/menu-inbound.router.js';

const DONO = '5581999990000';

const PIZZA: Operacao = {
  tipo: 'NOVO_ITEM',
  ref: 'n1',
  dados: {
    nome: 'Pizza Calabresa',
    precoBase: 40,
    categoria: 'Pizzas',
    variacoes: [{ nome: 'Tamanho', opcoes: [{ nome: 'M', precoAdicional: 0 }, { nome: 'G', precoAdicional: 10 }] }],
  },
};
const COCA: Operacao = { tipo: 'NOVO_ITEM', ref: 'n2', dados: { nome: 'Coca-Cola 2L', precoBase: 14, categoria: 'Bebidas' } };

function montarGestao(opcoes: { comIA?: boolean; permitidos?: string[] } = {}) {
  const whatsapp = criarWhatsAppClientFake();
  const gestaoRepo = criarGestaoRepositoryFake();
  const conversationRepo = criarConversationRepositoryFake();
  const ia = criarInterpretadorRoteiroFake();
  let proximaMensagem = 1;

  registrarMenuInboundRouter({
    whatsapp: whatsapp.client,
    conversationRepo,
    gestaoRepo,
    idempotency: criarIdempotencyRepositoryFake(),
    interpretador: opcoes.comIA === false ? undefined : ia,
    cadastro: criarCadastroPorLista(opcoes.permitidos ?? [DONO]),
  });

  async function enviar(texto: string, de = DONO, id = `msg-${proximaMensagem++}`): Promise<string[]> {
    const antes = whatsapp.mensagensEnviadas.length;
    await whatsapp.emitirMensagem({ id, telefone: de, corpo: texto, timestamp: new Date() });
    return whatsapp.mensagensEnviadas.slice(antes).map((mensagem) => mensagem.conteudo);
  }

  return { whatsapp, gestaoRepo, conversationRepo, ia, enviar };
}

describe('Fluxo 1 — dono cadastra o cardápio pelo WhatsApp (e2e in-process)', () => {
  it('grava os itens só depois do sim no resumo', async () => {
    const { gestaoRepo, ia, enviar } = montarGestao();

    ia.responder({ resposta: 'Anotei a pizza. Mais alguma coisa?', operacoes: [PIZZA] });
    await enviar('quero cadastrar pizza calabresa 40 reais, M ou G com 10 a mais');
    expect(gestaoRepo.salvos).toHaveLength(0);

    ia.responder({ operacoes: [COCA], finalizou: true });
    const resumo = (await enviar('e coca 2l 14, é isso')).join('\n');
    expect(resumo).toContain('Pizza Calabresa');
    expect(resumo).toContain('Coca-Cola 2L');
    expect(gestaoRepo.salvos).toHaveLength(0);

    const confirmacao = (await enviar('sim')).join('\n');

    // 2 itens + 2 categorias novas (Pizzas e Bebidas).
    expect(confirmacao).toContain('4 alterações salvas');
    expect(gestaoRepo.salvos).toHaveLength(1);
    const { empreendedorId, rascunho } = gestaoRepo.salvos[0]!;
    expect(empreendedorId).toBe(DONO);
    expect(rascunho.novosItens.map((item) => item.nome)).toEqual(['Pizza Calabresa', 'Coca-Cola 2L']);
    expect(rascunho.novasCategorias).toEqual(['Pizzas', 'Bebidas']);
    expect(rascunho.novosItens[0]?.variacoes?.[0]?.opcoes.map((opcao) => opcao.nome)).toEqual(['M', 'G']);
  });

  it('não grava nada quando o dono responde não no resumo', async () => {
    const { gestaoRepo, ia, enviar, conversationRepo } = montarGestao();

    ia.responder({ operacoes: [COCA], finalizou: true });
    await enviar('coca 2l 14, só isso');
    const resposta = (await enviar('não')).join('\n');

    expect(resposta).toContain('O que você quer ajustar?');
    expect(gestaoRepo.salvos).toHaveLength(0);
    expect(conversationRepo.conversaDe(DONO)?.estado).toBe('CONVERSANDO');
  });

  it('descarta o rascunho quando o dono manda cancelar', async () => {
    const { gestaoRepo, ia, enviar, conversationRepo } = montarGestao();

    ia.responder({ operacoes: [PIZZA] });
    await enviar('pizza calabresa 40');
    const resposta = (await enviar('cancelar')).join('\n');

    expect(resposta).toContain('descartei as alterações');
    expect(gestaoRepo.salvos).toHaveLength(0);
    expect(conversationRepo.conversaDe(DONO)?.estado).toBe('OCIOSO');
    expect(conversationRepo.conversaDe(DONO)?.contexto.rascunho.novosItens).toHaveLength(0);
  });

  it('processa uma vez só a mensagem reentregue pelo WhatsApp', async () => {
    const { ia, enviar } = montarGestao();

    ia.responder({ resposta: 'Anotei!', operacoes: [COCA] });
    const primeira = await enviar('coca 2l 14', DONO, 'msg-repetida');
    const reentrega = await enviar('coca 2l 14', DONO, 'msg-repetida');

    expect(primeira.length).toBeGreaterThan(0);
    expect(reentrega).toEqual([]);
    expect(ia.entradas).toHaveLength(1);
  });

  it('sem IA configurada só entende as palavras-chave', async () => {
    const { enviar } = montarGestao({ comIA: false });

    const livre = (await enviar('quero cadastrar uma pizza')).join('\n');
    const cardapio = (await enviar('cardápio')).join('\n');

    expect(livre).toContain('IA não configurada');
    expect(cardapio).not.toContain('IA não configurada');
  });

  it('responde que o número não tem acesso e não abre conversa para quem está fora da lista', async () => {
    const { enviar, conversationRepo, ia } = montarGestao({ permitidos: [DONO] });

    const resposta = await enviar('oi, quero cadastrar meu cardápio', '5511988887777');

    expect(resposta).toEqual([RESPOSTA_NUMERO_SEM_ACESSO]);
    expect(conversationRepo.conversaDe('5511988887777')).toBeUndefined();
    expect(ia.entradas).toHaveLength(0);
  });
});
