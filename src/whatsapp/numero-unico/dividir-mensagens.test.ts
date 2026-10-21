import { describe, expect, it } from 'vitest';
import { criarWhatsAppClientFake } from '../__mocks__/whatsapp-client.fake.js';
import type { MensagemRecebida } from '../whatsapp-client.interface.js';
import { dividirMensagens } from './dividir-mensagens.js';

function mensagem(corpo: string): MensagemRecebida {
  return { id: corpo, telefone: '5511988887777', corpo, timestamp: new Date() };
}

describe('dividirMensagens', () => {
  it('manda o código do pedido para pedidos e o resto para a gestão', async () => {
    const fake = criarWhatsAppClientFake();
    const { gestao, pedidos } = dividirMensagens(fake.client);
    const recebidas: string[] = [];
    gestao.onMessage((m) => {
      recebidas.push(`gestão: ${m.corpo}`);
    });
    pedidos.onMessage((m) => {
      recebidas.push(`pedidos: ${m.corpo}`);
    });

    await fake.emitirMensagem(mensagem('entrou pizza calabresa 39,90'));
    await fake.emitirMensagem(mensagem('Olá! Quero confirmar o pedido ped-7kq2'));

    expect(recebidas).toEqual(['gestão: entrou pizza calabresa 39,90', 'pedidos: Olá! Quero confirmar o pedido ped-7kq2']);
  });

  it('os dois lados enviam pelo mesmo número', async () => {
    const fake = criarWhatsAppClientFake();
    const { gestao, pedidos } = dividirMensagens(fake.client);

    await gestao.sendText('5511988887777', 'resumo');
    await pedidos.sendImage('5511988887777', 'data:image/png;base64,AAA', 'QR');

    expect(fake.mensagensEnviadas.map((m) => m.tipo)).toEqual(['texto', 'imagem']);
  });
});
