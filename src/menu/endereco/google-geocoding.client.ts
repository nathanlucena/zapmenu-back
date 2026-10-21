import { chamarServico, falhaHttp, IntegracaoError } from '../../shared/errors/integracao-error.js';
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

      const resposta = await chamarServico('google', 'Falha ao consultar o Google Geocoding', () =>
        fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
      );
      if (!resposta.ok) {
        throw falhaHttp('google', resposta.status, 'Falha ao consultar o Google Geocoding');
      }
      const dados = (await resposta.json()) as RespostaGoogle;
      if (dados.status === 'ZERO_RESULTS') {
        return null;
      }
      const primeiro = dados.results?.[0];
      if (dados.status !== 'OK' || !primeiro) {
        // Não inclui a URL na mensagem: ela carrega a chave.
        // OVER_QUERY_LIMIT e UNKNOWN_ERROR passam; REQUEST_DENIED (chave) e INVALID_REQUEST não.
        const temporario = dados.status === 'OVER_QUERY_LIMIT' || dados.status === 'UNKNOWN_ERROR';
        throw new IntegracaoError('google', `Google Geocoding respondeu ${dados.status}.`, temporario);
      }

      const componente = (tipo: string) => primeiro.address_components.find((item) => item.types.includes(tipo));
      const partes = {
        cep: componente('postal_code')?.long_name.replace(/\D/g, ''),
        logradouro: componente('route')?.long_name,
        numero: componente('street_number')?.long_name,
        bairro: (componente('sublocality_level_1') ?? componente('sublocality'))?.long_name,
        cidade: (componente('administrative_area_level_2') ?? componente('locality'))?.long_name,
        uf: componente('administrative_area_level_1')?.short_name,
      };
      const resultado: ResultadoGeocodificacao = {
        enderecoFormatado: montarEndereco(partes) ?? primeiro.formatted_address.replace(/,\s*Brasil$/i, ''),
        latitude: primeiro.geometry.location.lat,
        longitude: primeiro.geometry.location.lng,
        precisao: primeiro.geometry.location_type,
        correspondenciaParcial: Boolean(primeiro.partial_match),
        ...partes,
      };
      return resultado;
    },
  };
}

type PartesEndereco = Pick<ResultadoGeocodificacao, 'cep' | 'logradouro' | 'numero' | 'bairro' | 'cidade' | 'uf'>;

/**
 * O `formatted_address` às vezes começa com o nome de um estabelecimento que
 * fica no número (ex.: "Banco X - Av. Paulista, 1000..."), e esse texto vira o
 * endereço da loja. Montar pelos componentes evita isso; sem rua, cidade ou UF
 * não dá para montar e quem chama usa o `formatted_address`.
 */
export function montarEndereco(partes: PartesEndereco): string | undefined {
  const { logradouro, numero, bairro, cidade, uf, cep } = partes;
  if (!logradouro || !cidade || !uf) {
    return undefined;
  }
  const rua = numero ? `${logradouro}, ${numero}` : logradouro;
  const local = bairro ? `${rua} - ${bairro}` : rua;
  const cepFormatado = cep?.length === 8 ? `, ${cep.slice(0, 5)}-${cep.slice(5)}` : '';
  return `${local}, ${cidade} - ${uf}${cepFormatado}`;
}
