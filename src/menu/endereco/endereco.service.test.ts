import { describe, expect, it } from 'vitest';
import { criarEnderecoFake, GEO_AURORA } from './__mocks__/endereco.fake.js';
import { buscarEndereco, mesclarConsulta, normalizarCep } from './endereco.service.js';

describe('normalizarCep', () => {
  it.each(['50050-000', '50.050-000', '50050 000', '50050000'])('"%s" → 50050000', (cep) => {
    expect(normalizarCep(cep)).toBe('50050000');
  });
});

describe('mesclarConsulta', () => {
  it('soma a correção sem apagar o resto', () => {
    expect(mesclarConsulta({ cep: '50050000', numero: '123' }, { numero: '132' })).toEqual({ cep: '50050000', numero: '132' });
  });

  it('"sem número" e número se anulam', () => {
    expect(mesclarConsulta({ cep: '1', numero: '123' }, { semNumero: true })).toEqual({ cep: '1', semNumero: true });
    expect(mesclarConsulta({ cep: '1', semNumero: true }, { numero: '5' })).toEqual({ cep: '1', numero: '5' });
  });
});

describe('buscarEndereco', () => {
  it('completa pelo CEP, busca no Google e devolve o endereço sem avisos', async () => {
    const deps = criarEnderecoFake();
    const resultado = await buscarEndereco({ cep: '50050-000', numero: '123', complemento: 'loja 2' }, deps);

    expect(deps.buscasGeo).toEqual(['Rua da Aurora, 123, Boa Vista, Recife - PE, 50050-000, Brasil']);
    expect(resultado).toEqual({
      tipo: 'ENCONTRADO',
      avisos: [],
      endereco: expect.objectContaining({
        cep: '50050000',
        numero: '123',
        complemento: 'loja 2',
        cidade: 'Recife',
        uf: 'PE',
        latitude: GEO_AURORA.latitude,
        longitude: GEO_AURORA.longitude,
        enderecoFormatado: 'R. da Aurora, 123 - Boa Vista, Recife - PE, 50050-000 (loja 2)',
      }),
    });
  });

  it('CEP com tamanho errado não chama nenhuma API', async () => {
    const deps = criarEnderecoFake();
    expect(await buscarEndereco({ cep: '5005000', numero: '123' }, deps)).toEqual({ tipo: 'CEP_INVALIDO', cep: '5005000' });
    expect(deps.buscasCep).toHaveLength(0);
    expect(deps.buscasGeo).toHaveLength(0);
  });

  it('pede o número antes de buscar', async () => {
    const deps = criarEnderecoFake();
    expect(await buscarEndereco({ cep: '50050000' }, deps)).toEqual({ tipo: 'FALTA_NUMERO' });
    expect(deps.buscasGeo).toHaveLength(0);
  });

  it('sem CEP precisa de rua e cidade', async () => {
    const deps = criarEnderecoFake();
    expect(await buscarEndereco({ logradouro: 'Rua da Aurora', numero: '123' }, deps)).toEqual({ tipo: 'DADOS_INSUFICIENTES' });
  });

  it('aceita endereço por extenso sem CEP', async () => {
    const deps = criarEnderecoFake();
    const resultado = await buscarEndereco(
      { logradouro: 'rua da aurora', numero: '123', bairro: 'boa vista', cidade: 'recife' },
      deps,
    );
    expect(resultado.tipo).toBe('ENCONTRADO');
    expect(deps.buscasGeo).toEqual(['rua da aurora, 123, boa vista, recife, Brasil']);
  });

  it('CEP inexistente', async () => {
    const deps = criarEnderecoFake();
    expect(await buscarEndereco({ cep: '50050999', numero: '1' }, deps)).toEqual({
      tipo: 'CEP_NAO_ENCONTRADO',
      cep: '50050-999',
    });
  });

  it('ViaCEP fora do ar: segue para o Google com o CEP no texto', async () => {
    const deps = criarEnderecoFake();
    deps.cepFora = true;
    const resultado = await buscarEndereco({ cep: '50050000', numero: '123', logradouro: 'Rua da Aurora', cidade: 'Recife' }, deps);
    expect(resultado.tipo).toBe('ENCONTRADO');
    expect(deps.buscasGeo[0]).toContain('50050-000');
  });

  it('avisa quando o mapa não achou o número exato', async () => {
    const deps = criarEnderecoFake();
    deps.geo = { ...GEO_AURORA, precisao: 'GEOMETRIC_CENTER' };
    const resultado = await buscarEndereco({ cep: '50050000', numero: '123' }, deps);
    expect(resultado.tipo === 'ENCONTRADO' && resultado.avisos[0]).toContain('não o número exato');
  });

  it('avisa sobre correspondência parcial e CEP divergente', async () => {
    const deps = criarEnderecoFake();
    deps.geo = { ...GEO_AURORA, correspondenciaParcial: true, cep: '50050010' };
    const resultado = await buscarEndereco({ cep: '50050000', numero: '123' }, deps);
    expect(resultado.tipo === 'ENCONTRADO' && resultado.avisos).toEqual([
      expect.stringContaining('parecido'),
      expect.stringContaining('50050-010'),
    ]);
  });

  it('"sem número" busca e avisa da precisão', async () => {
    const deps = criarEnderecoFake();
    const resultado = await buscarEndereco({ cep: '50050000', semNumero: true }, deps);
    expect(resultado.tipo === 'ENCONTRADO' && resultado.endereco.numero).toBe('s/n');
    expect(resultado.tipo === 'ENCONTRADO' && resultado.avisos[0]).toContain('não o número exato');
  });

  it('nada encontrado e serviço fora do ar', async () => {
    const deps = criarEnderecoFake();
    deps.geo = null;
    expect(await buscarEndereco({ cep: '50050000', numero: '1' }, deps)).toEqual({ tipo: 'NAO_ENCONTRADO' });
    deps.geo = 'erro';
    expect(await buscarEndereco({ cep: '50050000', numero: '1' }, deps)).toEqual({ tipo: 'INDISPONIVEL' });
  });
});
