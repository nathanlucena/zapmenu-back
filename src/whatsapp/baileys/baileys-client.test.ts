import { EventEmitter } from 'node:events';
import type { WAMessage, WASocket } from 'baileys';
import { describe, expect, it, vi } from 'vitest';
import type { MensagemRecebida } from '../whatsapp-client.interface.js';
import { criarBaileysClient, type BaileysClientOptions } from './baileys-client.js';
import { MARCADOR_BOT } from './mensagem.js';

const CONTA = '5511900000001';

interface SocketFake {
  socket: WASocket;
  sendMessage: ReturnType<typeof vi.fn>;
  receber(mensagens: WAMessage[], type?: 'notify' | 'append'): Promise<void>;
}

function criarSocketFake(opcoes: { lids?: Record<string, string>; jidsNoWhatsApp?: Record<string, string> } = {}): SocketFake {
  const ev = new EventEmitter();
  const sendMessage = vi.fn(async () => undefined);
  const socket = {
    ev,
    user: { id: `${CONTA}:7@s.whatsapp.net`, lid: '99001@lid' },
    sendMessage,
    updateMediaMessage: vi.fn(),
    async onWhatsApp(telefone: string) {
      const jid = opcoes.jidsNoWhatsApp?.[telefone];
      return [{ jid: jid ?? `${telefone}@s.whatsapp.net`, exists: Boolean(jid) }];
    },
    signalRepository: {
      lidMapping: { getPNForLID: async (lid: string) => opcoes.lids?.[lid] ?? null },
    },
  } as unknown as WASocket;

  return {
    socket,
    sendMessage,
    async receber(mensagens, type = 'notify') {
      ev.emit('messages.upsert', { messages: mensagens, type });
      // O tratamento é assíncrono; deixa as promessas pendentes terminarem.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

function texto(remoteJid: string, conversa: string, extras: Partial<WAMessage['key']> = {}): WAMessage {
  return {
    key: { id: `ID-${conversa}`, remoteJid, fromMe: false, ...extras },
    message: { conversation: conversa },
    messageTimestamp: 1_760_000_000,
  };
}

function ouvir(fake: SocketFake, options?: BaileysClientOptions): MensagemRecebida[] {
  const recebidas: MensagemRecebida[] = [];
  criarBaileysClient(fake.socket, options).onMessage((mensagem) => {
    recebidas.push(mensagem);
  });
  return recebidas;
}

describe('criarBaileysClient', () => {
  it('entrega a mensagem com o telefone de quem escreveu', async () => {
    const fake = criarSocketFake();
    const recebidas = ouvir(fake);

    await fake.receber([texto('5511988887777@s.whatsapp.net', 'oi')]);

    expect(recebidas).toEqual([
      { id: 'ID-oi', telefone: '5511988887777', corpo: 'oi', imagemUrl: undefined, timestamp: new Date(1_760_000_000_000) },
    ]);
  });

  it('converte @lid no telefone real, pelo remoteJidAlt ou pelo mapeamento', async () => {
    const fake = criarSocketFake({ lids: { '123@lid': '5511977776666@s.whatsapp.net' } });
    const recebidas = ouvir(fake);

    await fake.receber([
      texto('555@lid', 'com alt', { remoteJidAlt: '5511955554444@s.whatsapp.net' }),
      texto('123@lid', 'sem alt'),
    ]);

    expect(recebidas.map((m) => m.telefone)).toEqual(['5511955554444', '5511977776666']);
  });

  it('ignora grupos, mensagens da própria conta, histórico e mídia que não é imagem', async () => {
    const fake = criarSocketFake();
    const recebidas = ouvir(fake);

    await fake.receber([
      texto('120363@g.us', 'grupo'),
      texto('5511988887777@s.whatsapp.net', 'minha', { fromMe: true }),
      {
        key: { id: 'A1', remoteJid: '5511988887777@s.whatsapp.net', fromMe: false },
        message: { audioMessage: {} },
      },
    ]);
    await fake.receber([texto('5511988887777@s.whatsapp.net', 'antiga')], 'append');

    expect(recebidas).toEqual([]);
  });

  it('usa a legenda como texto quando chega uma imagem', async () => {
    const fake = criarSocketFake();
    const recebidas = ouvir(fake);

    await fake.receber([
      {
        key: { id: 'IMG', remoteJid: '5511988887777@s.whatsapp.net', fromMe: false },
        message: { imageMessage: { caption: 'foto da pizza', mimetype: 'image/jpeg' } },
      },
    ]);

    // O download falha no fake; a mensagem segue sem a imagem, como no WhatsApp real com mídia expirada.
    expect(recebidas.map((m) => m.corpo)).toEqual(['foto da pizza']);
  });

  it('envia para o JID que o WhatsApp devolve, sem o 9º dígito quando é o caso', async () => {
    const fake = criarSocketFake({ jidsNoWhatsApp: { '5511988887777': '551188887777@s.whatsapp.net' } });
    const client = criarBaileysClient(fake.socket);

    await client.sendText('5511988887777', 'pedido confirmado');
    await client.sendText('5511911112222', 'olá');

    expect(fake.sendMessage.mock.calls).toEqual([
      ['551188887777@s.whatsapp.net', { text: 'pedido confirmado' }],
      ['5511911112222@s.whatsapp.net', { text: 'olá' }],
    ]);
  });

  it('envia imagem em data URI como buffer', async () => {
    const fake = criarSocketFake();
    const client = criarBaileysClient(fake.socket);

    await client.sendImage('5511911112222@s.whatsapp.net', 'data:image/png;base64,QUJD', 'QR do PIX');

    expect(fake.sendMessage).toHaveBeenCalledWith('5511911112222@s.whatsapp.net', {
      image: Buffer.from('ABC'),
      caption: 'QR do PIX',
    });
  });

  it('envia o QR do PIX em base64 puro (como vem do Mercado Pago) como buffer, e URL http como URL', async () => {
    const fake = criarSocketFake();
    const client = criarBaileysClient(fake.socket);

    await client.sendImage('5511911112222@s.whatsapp.net', 'QUJD', 'QR do PIX');
    await client.sendImage('5511911112222@s.whatsapp.net', 'https://exemplo.com/qr.png');

    expect(fake.sendMessage).toHaveBeenNthCalledWith(1, '5511911112222@s.whatsapp.net', {
      image: Buffer.from('ABC'),
      caption: 'QR do PIX',
    });
    expect(fake.sendMessage).toHaveBeenNthCalledWith(2, '5511911112222@s.whatsapp.net', {
      image: { url: 'https://exemplo.com/qr.png' },
      caption: '',
    });
  });

  describe('modo autoteste', () => {
    const autoteste = { telefoneProprio: CONTA, numerosPermitidos: ['5511922223333'] };

    it('atende o chat consigo mesmo e ignora as próprias respostas do bot', async () => {
      const fake = criarSocketFake();
      const recebidas = ouvir(fake, { autoteste });

      await fake.receber([
        texto('99001@lid', 'cardápio', { fromMe: true }),
        texto(`${CONTA}@s.whatsapp.net`, `${MARCADOR_BOT}resposta`, { fromMe: true }),
      ]);

      expect(recebidas.map((m) => [m.telefone, m.corpo])).toEqual([[CONTA, 'cardápio']]);
    });

    it('só atende os números permitidos e bloqueia envios para os outros', async () => {
      const fake = criarSocketFake();
      const recebidas = ouvir(fake, { autoteste });
      const client = criarBaileysClient(fake.socket, { autoteste });

      await fake.receber([
        texto('5511922223333@s.whatsapp.net', 'permitido'),
        texto('5511944445555@s.whatsapp.net', 'estranho'),
      ]);
      await client.sendText('5511944445555', 'não pode');
      await client.sendText('5511922223333', 'pode');

      expect(recebidas.map((m) => m.corpo)).toEqual(['permitido']);
      expect(fake.sendMessage.mock.calls).toEqual([['5511922223333@s.whatsapp.net', { text: `${MARCADOR_BOT}pode` }]]);
    });
  });
});
