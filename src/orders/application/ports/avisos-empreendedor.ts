export interface ContatoEmpreendedores {
  telefoneDe(empreendedorId: string): Promise<string | null>;
}

export interface MensageiroEmpreendedor {
  enviarTexto(telefone: string, texto: string): Promise<void>;
}
