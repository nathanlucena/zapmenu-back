import { describe, expect, it } from 'vitest';
import { criarWhatsAppClientFake } from './__mocks__/whatsapp-client.fake.js';
import { criarOrdersRepositoryFake } from '../orders/__mocks__/orders.repository.fake.js';
import { criarIdempotencyRepositoryFake } from '../shared/idempotency/__mocks__/idempotency.repository.fake.js';
import { IntegracaoError } from '../shared/errors/integracao-error.js';
import type { GestaoDeps } from '../menu/gestao/gestao.service.js';
import { registrarOrdersInboundRouter } from './orders-session/orders-inbound.router.js';
import { registrarMenuInboundRouter } from './menu-session/menu-inbound.router.js';
import type { MensagemRecebida } from './whatsapp-client.interface.js';

const mensagem = (id: string, corpo = 'PED-ABCD'): MensagemRecebida => ({
  id,
  telefone: '5511988887777',
  corpo,
  timestamp: new Date(),
});

describe('rede de segurança do WhatsApp', () => {
  it('pedido: erro inesperado responde o cliente, uma vez, e deixa a mensagem para reprocessar', async () => {
    const whatsapp = criarWhatsAppClientFake();
    const ordersRepo = criarOrdersRepositoryFake();
    const idempotency = criarIdempotencyRepositoryFake();
    let falhar = true;
    const buscar = ordersRepo.buscarPorCodigo.bind(ordersRepo);
    ordersRepo.buscarPorCodigo = async (codigo) => {
      if (falhar) throw new Error('banco caiu');
      return buscar(codigo);
    };
    registrarOrdersInboundRouter({
      whatsapp: whatsapp.client,
      ordersRepo,
      idempotency,
      geradorCobranca: { gerarCobranca: async () => ({ copiaCola: 'pix' }) },
      pedirAceite: async () => undefined,
    });

    await whatsapp.emitirMensagem(mensagem('m1'));
    await whatsapp.emitirMensagem(mensagem('m1'));

    expect(whatsapp.mensagensEnviadas.map((m) => m.conteudo)).toEqual([
      'Tive um problema agora 😕 Tente de novo em instantes.',
    ]);
    expect(await idempotency.jaProcessado('whatsapp_orders', 'm1')).toBe(false);

    falhar = false;
    await whatsapp.emitirMensagem(mensagem('m1'));
    expect(whatsapp.mensagensEnviadas.at(-1)?.conteudo).toContain('Não encontrei o pedido PED-ABCD');
    expect(await idempotency.jaProcessado('whatsapp_orders', 'm1')).toBe(true);
  });

  it('pagamento fora do ar tem mensagem própria', async () => {
    const whatsapp = criarWhatsAppClientFake();
    const ordersRepo = criarOrdersRepositoryFake();
    ordersRepo.buscarPorCodigo = async () => {
      throw new IntegracaoError('mercado_pago', 'Falha (HTTP 502).', true);
    };
    registrarOrdersInboundRouter({
      whatsapp: whatsapp.client,
      ordersRepo,
      idempotency: criarIdempotencyRepositoryFake(),
      geradorCobranca: { gerarCobranca: async () => ({ copiaCola: 'pix' }) },
      pedirAceite: async () => undefined,
    });

    await whatsapp.emitirMensagem(mensagem('m1'));

    expect(whatsapp.mensagensEnviadas[0]?.conteudo).toContain('O sistema de pagamento está instável agora');
  });

  it('gestão: erro fora do tratamento da conversa também recebe resposta', async () => {
    const whatsapp = criarWhatsAppClientFake();
    registrarMenuInboundRouter({
      ...({} as GestaoDeps),
      cadastro: {
        empreendedorIdDoTelefone: async () => {
          throw new Error('banco caiu');
        },
      },
      whatsapp: whatsapp.client,
      idempotency: criarIdempotencyRepositoryFake(),
    });

    await whatsapp.emitirMensagem(mensagem('g1', 'oi'));

    expect(whatsapp.mensagensEnviadas[0]?.conteudo).toBe('Tive um problema agora 😕 Tente de novo em instantes.');
  });

  it('voto que falha avisa a loja', async () => {
    const whatsapp = criarWhatsAppClientFake();
    const ordersRepo = criarOrdersRepositoryFake();
    ordersRepo.buscarPorEnquete = async () => {
      throw new Error('banco caiu');
    };
    registrarMenuInboundRouter({
      ...({} as GestaoDeps),
      whatsapp: whatsapp.client,
      idempotency: criarIdempotencyRepositoryFake(),
      decisoes: {
        ordersRepo,
        contatos: { telefoneDe: async () => '5511900000001' },
        geradorCobranca: { gerarCobranca: async () => ({ copiaCola: 'pix' }) },
        clientePedidos: () => undefined,
      },
    });

    await whatsapp.emitirVoto({ id: 'v1', telefone: '5511900000001', enqueteId: 'e1', opcoes: ['Aceitar'] });

    expect(whatsapp.mensagensEnviadas[0]?.conteudo).toBe(
      'Não consegui registrar seu voto. Tive um problema agora 😕 Tente de novo em instantes.',
    );
  });
});
