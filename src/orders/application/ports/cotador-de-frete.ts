import type { ServicoEnvio } from '../../domain/pedido.js';

export interface ItemParaFrete {
  itemCardapioId: string;
  quantidade: number;
  /** Para o valor declarado (seguro). */
  precoUnitario: number;
}

export interface PedidoDeCotacao {
  cepOrigem: string;
  cepDestino: string;
  itens: ItemParaFrete[];
}

/**
 * Frete por transportadora (Melhor Envio). Devolve os serviços que atendem o
 * CEP (vazio = nenhum). Lança DomainError FRETE_INDISPONIVEL quando a API não responde.
 */
export interface CotadorDeFrete {
  cotar(empreendedorId: string, pedido: PedidoDeCotacao): Promise<ServicoEnvio[]>;
}
