/** Situação da assinatura (preapproval) no Mercado Pago, já traduzida. */
export type SituacaoNoGateway = 'PENDENTE' | 'AUTORIZADA' | 'PAUSADA' | 'CANCELADA';

export interface AssinaturaNoGateway {
  id: string;
  situacao: SituacaoNoGateway;
  /** O que mandamos na criação: quem assina, o plano e o período. */
  referencia?: string;
  proximaCobranca?: Date;
}

export interface CobrancaNoGateway {
  id: string;
  /** A assinatura a que a cobrança pertence. */
  assinaturaId: string;
  situacao: 'APROVADA' | 'RECUSADA' | 'EM_ANDAMENTO';
  proximaCobranca?: Date;
}

export interface NovaAssinaturaNoGateway {
  referencia: string;
  /** E-mail da conta do Mercado Pago de quem paga. */
  email: string;
  descricao: string;
  valorCentavos: number;
  /** De quantos em quantos meses cobra (1 no mensal, 12 no anual). */
  meses: 1 | 12;
  /** Primeira cobrança (ex.: o fim do teste). Ausente = agora. */
  inicio?: Date;
}

/** Cobrança recorrente da assinatura do ZapMenu (Mercado Pago Assinaturas, conta do ZapMenu). */
export interface GatewayAssinaturas {
  /** Cria a assinatura pendente e devolve o link onde a loja cadastra o cartão. */
  criar(dados: NovaAssinaturaNoGateway): Promise<{ id: string; linkPagamento: string }>;
  consultar(id: string): Promise<AssinaturaNoGateway>;
  consultarCobranca(id: string): Promise<CobrancaNoGateway>;
  /** Novo valor a partir da próxima cobrança. */
  alterarValor(id: string, valorCentavos: number): Promise<void>;
  cancelar(id: string): Promise<void>;
}
