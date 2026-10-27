import type {
  ManipuladorMensagem,
  ManipuladorVoto,
  MensagemRecebida,
  VotoRecebido,
  WhatsAppClient,
} from '../whatsapp-client.interface.js';

export interface MensagemEnviada {
  telefone: string;
  tipo: 'texto' | 'imagem' | 'enquete' | 'documento';
  conteudo: string;
  legenda?: string;
  /** Só nas enquetes. */
  opcoes?: string[];
  /** Só nas enquetes: o id devolvido por sendPoll. */
  enqueteId?: string;
}

export interface WhatsAppClientFake {
  client: WhatsAppClient;
  mensagensEnviadas: MensagemEnviada[];
  emitirMensagem(mensagem: MensagemRecebida): Promise<void>;
  emitirVoto(voto: VotoRecebido): Promise<void>;
}

export function criarWhatsAppClientFake(): WhatsAppClientFake {
  const mensagensEnviadas: MensagemEnviada[] = [];
  const manipuladores: ManipuladorMensagem[] = [];
  const manipuladoresVoto: ManipuladorVoto[] = [];
  let proximaEnquete = 1;

  const client: WhatsAppClient = {
    async sendText(telefone, texto) {
      mensagensEnviadas.push({ telefone, tipo: 'texto', conteudo: texto });
    },
    async sendImage(telefone, imagemUrlOuBase64, legenda) {
      mensagensEnviadas.push({ telefone, tipo: 'imagem', conteudo: imagemUrlOuBase64, legenda });
    },
    async sendDocument(telefone, _dados, nomeArquivo, _mimetype, legenda) {
      mensagensEnviadas.push({ telefone, tipo: 'documento', conteudo: nomeArquivo, legenda });
    },
    async sendPoll(telefone, pergunta, opcoes) {
      const enqueteId = `enquete-${proximaEnquete++}`;
      mensagensEnviadas.push({ telefone, tipo: 'enquete', conteudo: pergunta, opcoes, enqueteId });
      return enqueteId;
    },
    onMessage(h) {
      manipuladores.push(h);
    },
    onPollVote(h) {
      manipuladoresVoto.push(h);
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
    async emitirVoto(voto) {
      for (const manipulador of manipuladoresVoto) {
        await manipulador(voto);
      }
    },
  };
}
