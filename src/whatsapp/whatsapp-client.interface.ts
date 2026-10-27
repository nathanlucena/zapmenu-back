export interface MensagemRecebida {
  id: string;
  telefone: string;
  corpo: string;
  imagemUrl?: string;
  /** Nota de voz ou áudio. `dados` só vem até 2 min (o resto nem é baixado) e não é guardado. */
  audio?: { dados?: Uint8Array; mimetype: string; segundos?: number };
  timestamp: Date;
}

export type ManipuladorMensagem = (mensagem: MensagemRecebida) => Promise<void> | void;

/** Voto numa enquete enviada pelo bot, já decifrado. */
export interface VotoRecebido {
  /** Id da mensagem do voto (para idempotência). */
  id: string;
  telefone: string;
  /** Id da enquete devolvido por `sendPoll`. */
  enqueteId: string;
  /** Opções marcadas, com o texto original. Vazio quando a pessoa tirou o voto. */
  opcoes: string[];
}

export type ManipuladorVoto = (voto: VotoRecebido) => Promise<void> | void;

export interface WhatsAppClient {
  sendText(telefone: string, texto: string): Promise<void>;
  sendImage(telefone: string, imagemUrlOuBase64: string, legenda?: string): Promise<void>;
  /** Envia uma enquete de escolha única; devolve o id dela, ou undefined se o envio foi bloqueado. */
  sendPoll(telefone: string, pergunta: string, opcoes: string[]): Promise<string | undefined>;
  /** Mostra "digitando..." para a pessoa. Opcional: nem todo cliente tem. */
  sendTyping?(telefone: string): Promise<void>;
  onMessage(manipulador: ManipuladorMensagem): void;
  onPollVote(manipulador: ManipuladorVoto): void;
}
