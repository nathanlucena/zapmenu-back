import { describe, expect, it, vi } from 'vitest';
import { criarGoogleGeocodingClient, montarEndereco } from './google-geocoding.client.js';
import { criarViaCepClient } from './viacep.client.js';

function respostaFake(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

describe('criarViaCepClient', () => {
  it('mapeia a resposta do ViaCEP', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      respostaFake({ cep: '50050-000', logradouro: 'Rua da Aurora', bairro: 'Boa Vista', localidade: 'Recife', uf: 'PE' }),
    );
    const cliente = criarViaCepClient(fetchMock as unknown as typeof fetch);

    expect(await cliente.buscarCep('50050000')).toEqual({
      cep: '50050000',
      logradouro: 'Rua da Aurora',
      bairro: 'Boa Vista',
      cidade: 'Recife',
      uf: 'PE',
    });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://viacep.com.br/ws/50050000/json/');
  });

  it('CEP inexistente vira null; falha do serviço lança erro', async () => {
    const inexistente = criarViaCepClient(vi.fn().mockResolvedValue(respostaFake({ erro: true })) as unknown as typeof fetch);
    expect(await inexistente.buscarCep('99999999')).toBeNull();

    const fora = criarViaCepClient(vi.fn().mockResolvedValue(respostaFake({}, false, 503)) as unknown as typeof fetch);
    await expect(fora.buscarCep('50050000')).rejects.toThrow('HTTP 503');
  });
});

describe('criarGoogleGeocodingClient', () => {
  const resultadoGoogle = {
    status: 'OK',
    results: [
      {
        formatted_address: 'R. da Aurora, 123 - Boa Vista, Recife - PE, 50050-000, Brasil',
        address_components: [
          { long_name: '123', short_name: '123', types: ['street_number'] },
          { long_name: 'Rua da Aurora', short_name: 'R. da Aurora', types: ['route'] },
          { long_name: 'Boa Vista', short_name: 'Boa Vista', types: ['sublocality_level_1', 'sublocality', 'political'] },
          { long_name: 'Recife', short_name: 'Recife', types: ['administrative_area_level_2', 'political'] },
          { long_name: 'Pernambuco', short_name: 'PE', types: ['administrative_area_level_1', 'political'] },
          { long_name: '50050-000', short_name: '50050-000', types: ['postal_code'] },
        ],
        geometry: { location: { lat: -8.0591, lng: -34.8798 }, location_type: 'ROOFTOP' },
      },
    ],
  };

  it('envia a busca restrita ao Brasil e mapeia o primeiro resultado', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaFake(resultadoGoogle));
    const cliente = criarGoogleGeocodingClient('chave-teste', fetchMock as unknown as typeof fetch);

    const resultado = await cliente.geocodificar('Rua da Aurora, 123, Recife');

    const url = fetchMock.mock.calls[0]![0] as URL;
    expect(url.searchParams.get('address')).toBe('Rua da Aurora, 123, Recife');
    expect(url.searchParams.get('components')).toBe('country:BR');
    expect(url.searchParams.get('key')).toBe('chave-teste');
    expect(resultado).toEqual({
      enderecoFormatado: 'Rua da Aurora, 123 - Boa Vista, Recife - PE, 50050-000',
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
    });
  });

  it('monta o endereço pelos componentes, sem o nome de estabelecimento do formatted_address', async () => {
    const comEstabelecimento = {
      status: 'OK',
      results: [
        {
          ...resultadoGoogle.results[0]!,
          formatted_address: 'Farmácia Aurora - R. da Aurora, 123 - Boa Vista, Recife - PE, 50050-000, Brasil',
        },
      ],
    };
    const cliente = criarGoogleGeocodingClient('k', vi.fn().mockResolvedValue(respostaFake(comEstabelecimento)) as unknown as typeof fetch);

    const resultado = await cliente.geocodificar('Rua da Aurora, 123, Recife');

    expect(resultado?.enderecoFormatado).toBe('Rua da Aurora, 123 - Boa Vista, Recife - PE, 50050-000');
  });

  it('usa o formatted_address quando faltam rua, cidade ou UF nos componentes', async () => {
    const semRua = {
      status: 'OK',
      results: [
        {
          ...resultadoGoogle.results[0]!,
          formatted_address: 'Recife - PE, Brasil',
          address_components: resultadoGoogle.results[0]!.address_components.filter((item) => !item.types.includes('route')),
        },
      ],
    };
    const cliente = criarGoogleGeocodingClient('k', vi.fn().mockResolvedValue(respostaFake(semRua)) as unknown as typeof fetch);

    expect((await cliente.geocodificar('Recife'))?.enderecoFormatado).toBe('Recife - PE');
  });

  it('ZERO_RESULTS vira null; outros status lançam erro sem expor a chave', async () => {
    const vazio = criarGoogleGeocodingClient('k', vi.fn().mockResolvedValue(respostaFake({ status: 'ZERO_RESULTS' })) as unknown as typeof fetch);
    expect(await vazio.geocodificar('x')).toBeNull();

    const negado = criarGoogleGeocodingClient(
      'chave-secreta',
      vi.fn().mockResolvedValue(respostaFake({ status: 'REQUEST_DENIED' })) as unknown as typeof fetch,
    );
    await expect(negado.geocodificar('x')).rejects.toThrow(/^Google Geocoding respondeu REQUEST_DENIED\.$/);
  });
});

describe('montarEndereco', () => {
  it('omite número, bairro e CEP quando não vieram', () => {
    expect(montarEndereco({ logradouro: 'Rua da Aurora', cidade: 'Recife', uf: 'PE' })).toBe('Rua da Aurora, Recife - PE');
  });
});
