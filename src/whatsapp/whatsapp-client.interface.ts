export interface MensagemRecebida {
  id: string;
  telefone: string;
  corpo: string;
  imagemUrl?: string;
  timestamp: Date;
}

export type ManipuladorMensagem = (mensagem: MensagemRecebida) => Promise<void> | void;

export interface WhatsAppClient {
  sendText(telefone: string, texto: string): Promise<void>;
  sendImage(telefone: string, imagemUrlOuBase64: string, legenda?: string): Promise<void>;
  onMessage(manipulador: ManipuladorMensagem): void;
}
