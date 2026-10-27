/** Por onde a loja é avisada (a sessão de gestão do WhatsApp). */
export interface MensageiroMelhorEnvio {
  enviarTexto(telefone: string, texto: string): Promise<void>;
}
