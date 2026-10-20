import type { Geocodificador, ResultadoGeocodificacao } from './endereco.types.js';

const BASE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const TIMEOUT_MS = 5_000;

interface ComponenteGoogle {
  long_name: string;
  short_name: string;
  types: string[];
}

interface RespostaGoogle {
  status: string;
  results?: {
    formatted_address: string;
    partial_match?: boolean;
    address_components: ComponenteGoogle[];
    geometry: { location: { lat: number; lng: number }; location_type: string };
  }[];
}

export function criarGoogleGeocodingClient(apiKey: string, fetchFn: typeof fetch = fetch): Geocodificador {
  return {
    async geocodificar(endereco) {
      const url = new URL(BASE_URL);
      url.searchParams.set('address', endereco);
      url.searchParams.set('components', 'country:BR');
      url.searchParams.set('region', 'br');
      url.searchParams.set('language', 'pt-BR');
      url.searchParams.set('key', apiKey);

      const resposta = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!resposta.ok) {
        throw new Error(`Falha ao consultar o Google Geocoding (HTTP ${resposta.status}).`);
      }
      const dados = (await resposta.json()) as RespostaGoogle;
      if (dados.status === 'ZERO_RESULTS') {
        return null;
      }
      const primeiro = dados.results?.[0];
      if (dados.status !== 'OK' || !primeiro) {
        // Não inclui a URL na mensagem: ela carrega a chave.
        throw new Error(`Google Geocoding respondeu ${dados.status}.`);
      }

      const componente = (tipo: string) => primeiro.address_components.find((item) => item.types.includes(tipo));
      const resultado: ResultadoGeocodificacao = {
        enderecoFormatado: primeiro.formatted_address.replace(/,\s*Brasil$/i, ''),
        latitude: primeiro.geometry.location.lat,
        longitude: primeiro.geometry.location.lng,
        precisao: primeiro.geometry.location_type,
        correspondenciaParcial: Boolean(primeiro.partial_match),
        cep: componente('postal_code')?.long_name.replace(/\D/g, ''),
        logradouro: componente('route')?.long_name,
        numero: componente('street_number')?.long_name,
        bairro: (componente('sublocality_level_1') ?? componente('sublocality'))?.long_name,
        cidade: (componente('administrative_area_level_2') ?? componente('locality'))?.long_name,
        uf: componente('administrative_area_level_1')?.short_name,
      };
      return resultado;
    },
  };
}
