import { describe, expect, it } from 'vitest';
import { criarWhatsAppClientFake } from '../__mocks__/whatsapp-client.fake.js';
import { identificarBot, ROTULO_GESTAO, ROTULO_PEDIDOS } from './identificar-bot.js';

describe('identificarBot', () => {
  it('põe o nome do bot antes do texto e da legenda', async () => {
    const fake = criarWhatsAppClientFake();
    const gestao = identificarBot(fake.client, ROTULO_GESTAO);
    const pedidos = identificarBot(fake.client, ROTULO_PEDIDOS);

    await gestao.sendText('5511988887777', 'Cardápio salvo');
    await pedidos.sendImage('5511988887777', 'data:image/png;base64,AAA', 'QR Code do Pix');
    await pedidos.sendImage('5511988887777', 'data:image/png;base64,AAA');

    expect(fake.mensagensEnviadas).toMatchObject([
      { tipo: 'texto', conteudo: `${ROTULO_GESTAO}\nCardápio salvo` },
      { tipo: 'imagem', legenda: `${ROTULO_PEDIDOS}\nQR Code do Pix` },
      { tipo: 'imagem', legenda: ROTULO_PEDIDOS },
    ]);
  });

  it('repassa as mensagens recebidas sem mudança', async () => {
    const fake = criarWhatsAppClientFake();
    const recebidas: string[] = [];
    identificarBot(fake.client, ROTULO_GESTAO).onMessage((m) => {
      recebidas.push(m.corpo);
    });

    await fake.emitirMensagem({ id: '1', telefone: '5511988887777', corpo: 'oi', timestamp: new Date() });

    expect(recebidas).toEqual(['oi']);
  });
});
