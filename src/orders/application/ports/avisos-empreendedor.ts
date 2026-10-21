export interface ContatoEmpreendedores {
  telefoneDe(empreendedorId: string): Promise<string | null>;
}

export interface MensageiroEmpreendedor {
  enviarTexto(telefone: string, texto: string): Promise<void>;
  /** Devolve o id da enquete, ou undefined se não deu para enviar. */
  enviarEnquete?(telefone: string, pergunta: string, opcoes: string[]): Promise<string | undefined>;
}
