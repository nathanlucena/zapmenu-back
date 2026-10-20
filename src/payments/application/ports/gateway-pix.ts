export interface CriarCobrancaPixInput {
  valor: number;
  descricao: string;
  referenciaExterna: string;
}

export interface CobrancaPixCriada {
  idTransacaoExterno: string;
  statusMp: string;
  copiaCola?: string;
  qrCodeBase64?: string;
}

export interface ConsultaPagamento {
  statusMp: string;
}

/** Quem gera e consulta a cobrança PIX (hoje, o Mercado Pago). */
export interface GatewayPix {
  criarCobrancaPix(input: CriarCobrancaPixInput): Promise<CobrancaPixCriada>;
  consultarPagamento(idTransacaoExterno: string): Promise<ConsultaPagamento>;
}
