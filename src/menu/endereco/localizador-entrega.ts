import type { LocalizadorEndereco } from '../../orders/application/ports/loja-para-pedidos.js';
import { buscarEndereco } from './endereco.service.js';
import type { EnderecoDeps } from './endereco.types.js';

/** A mesma busca do endereço da loja (ViaCEP + Google), usada para o endereço do cliente. */
export function criarLocalizadorEntrega(deps: EnderecoDeps): LocalizadorEndereco {
  return {
    async localizar(digitado) {
      const resultado = await buscarEndereco(digitado, deps);
      switch (resultado.tipo) {
        case 'ENCONTRADO': {
          const { precisao: _precisao, ...endereco } = resultado.endereco;
          return { tipo: 'ENCONTRADO', endereco, avisos: resultado.avisos };
        }
        case 'CEP_INVALIDO':
          return { tipo: 'INVALIDO', motivo: `O CEP ${resultado.cep} não é válido.` };
        case 'CEP_NAO_ENCONTRADO':
          return { tipo: 'INVALIDO', motivo: `Não encontramos o CEP ${resultado.cep}.` };
        case 'FALTA_NUMERO':
          return { tipo: 'INVALIDO', motivo: 'Informe o número do endereço (ou marque "sem número").' };
        case 'DADOS_INSUFICIENTES':
          return { tipo: 'INVALIDO', motivo: 'Informe o CEP, ou a rua e a cidade.' };
        case 'NAO_ENCONTRADO':
          return { tipo: 'NAO_ENCONTRADO' };
        case 'INDISPONIVEL':
          return { tipo: 'INDISPONIVEL' };
      }
    },
  };
}
