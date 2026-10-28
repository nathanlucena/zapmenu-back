import type { ServicoEnvio } from '../../../orders/domain/pedido.js';
import type { ProdutoDoPacote } from '../../domain/pacote.js';

export interface TokensMelhorEnvio {
  accessToken: string;
  refreshToken: string;
  expiraEm: Date;
}

/** Quem envia ou recebe, para a etiqueta. */
export interface PontaDoEnvio {
  nome: string;
  telefone?: string;
  email?: string;
  /** CPF ou CNPJ, só números. Algumas transportadoras exigem. */
  documento?: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
}

export interface EtiquetaParaComprar {
  servicoId: string;
  de: PontaDoEnvio;
  para: PontaDoEnvio;
  produtos: ProdutoDoPacote[];
  /** Código do pedido no ZapMenu, para aparecer no Melhor Envio. */
  referencia: string;
}

export interface EtiquetaComprada {
  etiquetaId: string;
  rastreio?: string;
}

/** API do Melhor Envio (sandbox nos testes e no desenvolvimento). Lança erro quando falha. */
export interface GatewayMelhorEnvio {
  urlDeAutorizacao(state: string): string;
  trocarCodigo(codigo: string): Promise<TokensMelhorEnvio>;
  renovar(refreshToken: string): Promise<TokensMelhorEnvio>;
  cotar(accessToken: string, pedido: { cepOrigem: string; cepDestino: string; produtos: ProdutoDoPacote[] }): Promise<ServicoEnvio[]>;
  /** Põe no carrinho, paga com o saldo do lojista e gera a etiqueta. */
  comprarEtiqueta(accessToken: string, etiqueta: EtiquetaParaComprar): Promise<EtiquetaComprada>;
  baixarEtiqueta(accessToken: string, etiquetaId: string): Promise<Uint8Array>;
}
