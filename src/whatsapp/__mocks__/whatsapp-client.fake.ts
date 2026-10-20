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
  let manipulador: ManipuladorMensagem | undefined;

  const client: WhatsAppClient = {
    async sendText(telefone, texto) {
      mensagensEnviadas.push({ telefone, tipo: 'texto', conteudo: texto });
    },
    async sendImage(telefone, imagemUrlOuBase64, legenda) {
      mensagensEnviadas.push({ telefone, tipo: 'imagem', conteudo: imagemUrlOuBase64, legenda });
    },
    onMessage(h) {
      manipulador = h;
    },
  };

  return {
    client,
    mensagensEnviadas,
    async emitirMensagem(mensagem) {
      if (!manipulador) {
        throw new Error('Nenhum manipulador de mensagens registrado.');
      }
      await manipulador(mensagem);
    },
  };
}
