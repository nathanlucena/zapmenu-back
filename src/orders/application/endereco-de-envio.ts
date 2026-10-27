import { DomainError } from '../../shared/errors/domain-error.js';
import type { EnderecoEnvio } from '../domain/pedido.js';
import type { ConsultaCepParaEnvio, EnderecoDigitado } from './ports/loja-para-pedidos.js';

const formatarCep = (cep: string) => `${cep.slice(0, 5)}-${cep.slice(5)}`;

/** "Rua X, 123 - apto 2 - Boa Vista, Recife - PE, 50050-000" */
function formatarEndereco(endereco: Omit<EnderecoEnvio, 'enderecoFormatado'>): string {
  const rua = [endereco.logradouro, endereco.numero].filter(Boolean).join(', ');
  const cidade = [endereco.cidade, endereco.uf].filter(Boolean).join(' - ');
  return [rua, endereco.complemento, endereco.bairro && cidade ? `${endereco.bairro}, ${cidade}` : endereco.bairro ?? cidade]
    .filter(Boolean)
    .join(' - ')
    .concat(endereco.cep ? `, ${formatarCep(endereco.cep)}` : '');
}

/**
 * Endereço de envio por transportadora: o CEP completa rua, bairro e cidade
 * (ViaCEP), sem mapa nem raio. Lança ENDERECO_INVALIDO quando falta algo.
 */
export async function enderecoDeEnvio(
  consultaCep: ConsultaCepParaEnvio | undefined,
  digitado: EnderecoDigitado,
): Promise<EnderecoEnvio> {
  const cep = (digitado.cep ?? '').replace(/\D/g, '');
  if (cep.length !== 8) {
    throw new DomainError('Informe o CEP de entrega, com 8 números.', 'ENDERECO_INVALIDO');
  }
  const numero = digitado.semNumero ? 's/n' : digitado.numero?.trim();
  if (!numero) {
    throw new DomainError('Informe o número do endereço (ou marque "sem número").', 'ENDERECO_INVALIDO');
  }
  if (!consultaCep) {
    throw new DomainError('O envio está indisponível no momento.', 'ENVIO_INDISPONIVEL', 'INDISPONIVEL');
  }

  let dados;
  try {
    dados = await consultaCep.buscarCep(cep);
  } catch {
    throw new DomainError(
      'Não conseguimos consultar o CEP agora. Tente de novo em instantes.',
      'ENDERECO_INDISPONIVEL',
      'INDISPONIVEL',
    );
  }
  if (!dados?.uf) {
    throw new DomainError(`Não encontramos o CEP ${formatarCep(cep)}.`, 'ENDERECO_INVALIDO');
  }
  // CEP de cidade pequena vem sem rua: aí ela precisa vir digitada.
  const logradouro = digitado.logradouro?.trim() || dados.logradouro;
  if (!logradouro) {
    throw new DomainError('Informe a rua do endereço de entrega.', 'ENDERECO_INVALIDO');
  }

  const endereco: Omit<EnderecoEnvio, 'enderecoFormatado'> = {
    cep,
    logradouro,
    numero,
    complemento: digitado.complemento?.trim() || undefined,
    bairro: digitado.bairro?.trim() || dados.bairro,
    cidade: dados.cidade ?? digitado.cidade,
    uf: dados.uf,
  };
  return { ...endereco, enderecoFormatado: formatarEndereco(endereco) };
}
