import { chamarServico, falhaHttp } from '../../shared/errors/integracao-error.js';
import type { ConsultaCep, DadosCep } from './endereco.types.js';

const TIMEOUT_MS = 5_000;

interface RespostaViaCep {
  erro?: boolean | string;
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
}

const preenchido = (valor?: string) => valor?.trim() || undefined;

export function criarViaCepClient(fetchFn: typeof fetch = fetch): ConsultaCep {
  return {
    async buscarCep(cep) {
      const resposta = await chamarServico('viacep', 'Falha ao consultar o ViaCEP', () =>
        fetchFn(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
      );
      // O ViaCEP responde 400 para CEP mal formatado e { erro: true } para CEP inexistente.
      if (resposta.status === 400) {
        return null;
      }
      if (!resposta.ok) {
        throw falhaHttp('viacep', resposta.status, 'Falha ao consultar o ViaCEP');
      }
      const dados = (await resposta.json()) as RespostaViaCep;
      if (dados.erro) {
        return null;
      }
      const resultado: DadosCep = {
        cep,
        logradouro: preenchido(dados.logradouro),
        bairro: preenchido(dados.bairro),
        cidade: preenchido(dados.localidade),
        uf: preenchido(dados.uf),
      };
      return resultado;
    },
  };
}
