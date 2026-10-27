import { describe, expect, it } from 'vitest';
import { criarOrdersRepositoryFake } from '../../orders/__mocks__/orders.repository.fake.js';
import { criarIdempotencyRepositoryFake } from '../../shared/idempotency/__mocks__/idempotency.repository.fake.js';
import { criarWhatsAppClientFake } from '../__mocks__/whatsapp-client.fake.js';
import { registrarOrdersInboundRouter } from './orders-inbound.router.js';

function cenario(ouvirAudio?: Parameters<typeof registrarOrdersInboundRouter>[0]['ouvirAudio']) {
  const whatsapp = criarWhatsAppClientFake();
  registrarOrdersInboundRouter({
    whatsapp: whatsapp.client,
    ordersRepo: criarOrdersRepositoryFake(),
    idempotency: criarIdempotencyRepositoryFake(),
    geradorCobranca: { gerarCobranca: async () => ({ copiaCola: 'x' }) as never },
    pedirAceite: async () => undefined,
    ouvirAudio,
  });
  const mandarAudio = () =>
    whatsapp.emitirMensagem({
      id: 'a1',
      telefone: '5581988887777',
      corpo: '',
      audio: { dados: new Uint8Array([1]), mimetype: 'audio/ogg', segundos: 5 },
      timestamp: new Date(),
    });
  return { whatsapp, mandarAudio };
}

describe('número de pedidos: áudio do cliente', () => {
  it('o texto entendido segue o fluxo normal (procura o código do pedido)', async () => {
    const { whatsapp, mandarAudio } = cenario(async () => ({ tipo: 'TEXTO', texto: 'meu pedido é o PED-AB23' }));
    await mandarAudio();
    expect(whatsapp.mensagensEnviadas.at(-1)?.conteudo).toContain('Não encontrei o pedido PED-AB23');
  });

  it('sem transcrição, pede para escrever', async () => {
    const { whatsapp, mandarAudio } = cenario();
    await mandarAudio();
    expect(whatsapp.mensagensEnviadas.at(-1)?.conteudo).toContain('não consigo ouvir áudios');
  });
});
