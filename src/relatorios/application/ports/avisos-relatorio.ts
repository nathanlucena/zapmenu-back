/** Por onde o relatório chega (a sessão de gestão do WhatsApp). */
export interface MensageiroRelatorios {
  enviarTexto(telefone: string, texto: string): Promise<void>;
}
