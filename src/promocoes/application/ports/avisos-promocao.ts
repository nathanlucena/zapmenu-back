/** Por onde a loja é avisada (a sessão de gestão do WhatsApp). */
export interface MensageiroPromocoes {
  enviarTexto(telefone: string, texto: string): Promise<void>;
}
