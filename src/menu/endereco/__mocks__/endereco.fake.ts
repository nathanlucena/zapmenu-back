import type { ConsultaCep, DadosCep, EnderecoDeps, Geocodificador, ResultadoGeocodificacao } from '../endereco.types.js';

export const CEP_AURORA: DadosCep = {
  cep: '50050000',
  logradouro: 'Rua da Aurora',
  bairro: 'Boa Vista',
  cidade: 'Recife',
  uf: 'PE',
};

export const GEO_AURORA: ResultadoGeocodificacao = {
  enderecoFormatado: 'R. da Aurora, 123 - Boa Vista, Recife - PE, 50050-000',
  latitude: -8.0591,
  longitude: -34.8798,
  precisao: 'ROOFTOP',
  correspondenciaParcial: false,
  cep: '50050000',
  logradouro: 'Rua da Aurora',
  numero: '123',
  bairro: 'Boa Vista',
  cidade: 'Recife',
  uf: 'PE',
};

export interface EnderecoFake extends EnderecoDeps {
  ceps: Map<string, DadosCep>;
  /** Resposta do geocodificador; `erro` simula serviço fora do ar. */
  geo: ResultadoGeocodificacao | null | 'erro';
  cepFora: boolean;
  buscasGeo: string[];
  buscasCep: string[];
}

export function criarEnderecoFake(): EnderecoFake {
  const fake: EnderecoFake = {
    ceps: new Map([[CEP_AURORA.cep, CEP_AURORA]]),
    geo: GEO_AURORA,
    cepFora: false,
    buscasGeo: [],
    buscasCep: [],
    consultaCep: undefined as unknown as ConsultaCep,
    geocodificador: undefined as unknown as Geocodificador,
  };
  fake.consultaCep = {
    async buscarCep(cep) {
      fake.buscasCep.push(cep);
      if (fake.cepFora) {
        throw new Error('ViaCEP fora do ar');
      }
      return fake.ceps.get(cep) ?? null;
    },
  };
  fake.geocodificador = {
    async geocodificar(endereco) {
      fake.buscasGeo.push(endereco);
      if (fake.geo === 'erro') {
        throw new Error('Google fora do ar');
      }
      return fake.geo;
    },
  };
  return fake;
}
