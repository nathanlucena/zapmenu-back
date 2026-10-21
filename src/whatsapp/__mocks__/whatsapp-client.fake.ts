import type { ManipuladorMensagem, MensagemRecebida, WhatsAppClient } from '../whatsapp-client.interface.js';

export interface MensagemEnviada {
  telefone: string;
  tipo: 'texto' | 'imagem';
  conteudo: string;
  legenda?: string;
}

export interface WhatsAppClientFake {
  client: WhatsAppClient;
  mensagensEnviadas: MensagemEnviada[];
  emitirMensagem(mensagem: MensagemRecebida): Promise<void>;
}

export function criarWhatsAppClientFake(): WhatsAppClientFake {
  const mensagensEnviadas: MensagemEnviada[] = [];
  const manipuladores: ManipuladorMensagem[] = [];

  const client: WhatsAppClient = {
    async sendText(telefone, texto) {
      mensagensEnviadas.push({ telefone, tipo: 'texto', conteudo: texto });
    },
    async sendImage(telefone, imagemUrlOuBase64, legenda) {
      mensagensEnviadas.push({ telefone, tipo: 'imagem', conteudo: imagemUrlOuBase64, legenda });
    },
    onMessage(h) {
      manipuladores.push(h);
    },
  };

  return {
    client,
    mensagensEnviadas,
    async emitirMensagem(mensagem) {
      if (manipuladores.length === 0) {
        throw new Error('Nenhum manipulador de mensagens registrado.');
      }
      for (const manipulador of manipuladores) {
        await manipulador(mensagem);
      }
    },
  };
}
