/** Dados de um CEP (ViaCEP). */
export interface DadosCep {
  cep: string;
  logradouro?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
}

export interface ConsultaCep {
  /** null = CEP não existe. Lança erro se o serviço falhar. */
  buscarCep(cep: string): Promise<DadosCep | null>;
}

export interface ResultadoGeocodificacao {
  /** Endereço como o mapa entendeu, já sem ", Brasil". */
  enderecoFormatado: string;
  latitude: number;
  longitude: number;
  precisao: string;
  /** O mapa encontrou um endereço parecido, não idêntico ao pedido. */
  correspondenciaParcial: boolean;
  cep?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
}

export interface Geocodificador {
  /** null = nada encontrado. Lança erro se o serviço falhar. */
  geocodificar(endereco: string): Promise<ResultadoGeocodificacao | null>;
}

export interface EnderecoDeps {
  consultaCep: ConsultaCep;
  geocodificador: Geocodificador;
}
