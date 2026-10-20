import { calcularEntrega, entregaConfigurada } from '../../menu/entrega.js';
import { DomainError } from '../../shared/errors/domain-error.js';
import type { EnderecoEntrega } from '../domain/pedido.js';
import type { EnderecoDigitado, LocalizadorEndereco, RegrasDaLoja } from './ports/loja-para-pedidos.js';

export interface CotacaoEntrega {
  endereco: EnderecoEntrega;
  taxa: number;
  /** Alertas do mapa para o cliente conferir (número não achado, CEP diferente…). */
  avisos: string[];
}

/**
 * Localiza o endereço do cliente e calcula a taxa pela distância até a loja.
 * É a mesma conta usada ao criar o pedido, então o valor mostrado no app bate
 * com o cobrado.
 */
export async function cotarEntrega(
  regras: RegrasDaLoja,
  localizador: LocalizadorEndereco | undefined,
  digitado: EnderecoDigitado,
): Promise<CotacaoEntrega> {
  const loja = { fazEntrega: regras.fazEntrega, enderecoVerificado: regras.origem, faixasEntrega: regras.faixasEntrega };
  // Antes de gastar uma consulta ao mapa, confere se a loja entrega.
  if (!regras.fazEntrega) {
    throw new DomainError('Esta loja não faz entrega.', 'ENTREGA_INDISPONIVEL');
  }
  if (!entregaConfigurada(loja)) {
    throw new DomainError('Esta loja ainda não configurou a entrega.', 'ENTREGA_INDISPONIVEL');
  }
  if (!localizador) {
    throw new DomainError('A entrega está indisponível no momento.', 'ENTREGA_INDISPONIVEL', 'INDISPONIVEL');
  }

  const localizado = await localizador.localizar(digitado);
  switch (localizado.tipo) {
    case 'INVALIDO':
      throw new DomainError(localizado.motivo, 'ENDERECO_INVALIDO');
    case 'NAO_ENCONTRADO':
      throw new DomainError('Não encontramos esse endereço no mapa. Confira o CEP e o número.', 'ENDERECO_NAO_ENCONTRADO');
    case 'INDISPONIVEL':
      throw new DomainError(
        'Não conseguimos consultar o mapa agora. Tente de novo em instantes.',
        'ENDERECO_INDISPONIVEL',
        'INDISPONIVEL',
      );
  }

  const entrega = calcularEntrega(loja, localizado.endereco);
  if (!entrega.disponivel) {
    throw new DomainError('Esse endereço fica fora da área de entrega da loja.', 'FORA_DA_AREA');
  }
  return {
    endereco: { ...localizado.endereco, distanciaKm: Math.round(entrega.distanciaKm * 100) / 100 },
    taxa: entrega.taxa,
    avisos: localizado.avisos,
  };
}
