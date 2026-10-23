import { describe, expect, it } from 'vitest';
import { criarEnderecoFake } from '../../menu/endereco/__mocks__/endereco.fake.js';
import { cotarEnvio } from './cotar-envio.js';
import type { RegrasDaLoja } from './ports/loja-para-pedidos.js';

const regras = (envio: RegrasDaLoja['envio']): RegrasDaLoja => ({
  aceitaRetirada: true,
  fazEntrega: false,
  aceitaPagamentoNaEntrega: true,
  cadastroCompleto: true,
  faixasEntrega: [],
  horarios: [],
  envio,
});
const AURORA = { cep: '50050-000', numero: '123', complemento: 'apto 201' };

describe('cotarEnvio', () => {
  it('usa o frete da UF quando tem, senão o valor para o Brasil', async () => {
    const endereco = criarEnderecoFake();

    const comExcecao = await cotarEnvio(regras({ padrao: 25, porUf: { PE: 12 } }), endereco.consultaCep, AURORA);
    const soPadrao = await cotarEnvio(regras({ padrao: 25, porUf: {} }), endereco.consultaCep, AURORA);

    expect(comExcecao.frete).toBe(12);
    expect(soPadrao.frete).toBe(25);
    expect(comExcecao.endereco).toEqual({
      cep: '50050000',
      logradouro: 'Rua da Aurora',
      numero: '123',
      complemento: 'apto 201',
      bairro: 'Boa Vista',
      cidade: 'Recife',
      uf: 'PE',
      enderecoFormatado: 'Rua da Aurora, 123 - apto 201 - Boa Vista, Recife - PE, 50050-000',
    });
    // Sem mapa: só o CEP.
    expect(endereco.buscasGeo).toEqual([]);
  });

  it('recusa UF sem frete e loja que não envia', async () => {
    const endereco = criarEnderecoFake();

    await expect(cotarEnvio(regras({ porUf: { SP: 30 } }), endereco.consultaCep, AURORA)).rejects.toMatchObject({
      code: 'FORA_DA_AREA',
      message: 'A loja não envia para PE.',
    });
    await expect(cotarEnvio(regras(undefined), endereco.consultaCep, AURORA)).rejects.toMatchObject({
      code: 'ENVIO_INDISPONIVEL',
    });
  });

  it('pede CEP válido, número e rua quando o CEP não tem', async () => {
    const endereco = criarEnderecoFake();
    endereco.ceps.set('55000000', { cep: '55000000', cidade: 'Caruaru', uf: 'PE' });
    const envio = regras({ padrao: 25, porUf: {} });

    await expect(cotarEnvio(envio, endereco.consultaCep, { cep: '123', numero: '1' })).rejects.toMatchObject({
      code: 'ENDERECO_INVALIDO',
    });
    await expect(cotarEnvio(envio, endereco.consultaCep, { cep: '50050000' })).rejects.toMatchObject({
      message: 'Informe o número do endereço (ou marque "sem número").',
    });
    await expect(cotarEnvio(envio, endereco.consultaCep, { cep: '55000000', numero: '9' })).rejects.toMatchObject({
      message: 'Informe a rua do endereço de entrega.',
    });
    await expect(cotarEnvio(envio, endereco.consultaCep, { cep: '99999999', numero: '9' })).rejects.toMatchObject({
      message: 'Não encontramos o CEP 99999-999.',
    });
    const comRua = await cotarEnvio(envio, endereco.consultaCep, { cep: '55000000', numero: '9', logradouro: 'Rua Nova' });
    expect(comRua.endereco.enderecoFormatado).toBe('Rua Nova, 9 - Caruaru - PE, 55000-000');
  });

  it('ViaCEP fora do ar: erro de indisponibilidade, para tentar de novo', async () => {
    const endereco = criarEnderecoFake();
    endereco.cepFora = true;

    await expect(cotarEnvio(regras({ padrao: 25, porUf: {} }), endereco.consultaCep, AURORA)).rejects.toMatchObject({
      code: 'ENDERECO_INDISPONIVEL',
      tipo: 'INDISPONIVEL',
    });
  });
});
