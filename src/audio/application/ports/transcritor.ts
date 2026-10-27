export interface AudioParaTranscrever {
  dados: Uint8Array;
  /** Ex.: "audio/ogg; codecs=opus" (nota de voz do WhatsApp). */
  mimetype: string;
}

/** Fala → texto em português. Lança erro se o serviço falhar. */
export interface Transcritor {
  transcrever(audio: AudioParaTranscrever): Promise<string>;
}
