import type { Medidas } from '../../domain/pacote.js';
import type { PontaDoEnvio, TokensMelhorEnvio } from './gateway-melhor-envio.js';

export interface ContaDaLoja {
  lojaId: string;
  telefone: string;
  tokens?: TokensMelhorEnvio;
  /** Primeira falha seguida da API; o aviso ao lojista sai depois de 30 min, uma vez. */
  falhaDesde?: Date;
  avisoFalhaEm?: Date;
}

export interface ContasMelhorEnvioRepository {
  /** Pelo id do empreendedor, telefone ou id da loja. null = loja não existe. */
  daLoja(identificador: string): Promise<ContaDaLoja | null>;
  salvarTokens(lojaId: string, tokens: TokensMelhorEnvio): Promise<void>;
  registrarFalha(lojaId: string, desde: Date): Promise<void>;
  registrarAvisoDeFalha(lojaId: string, em: Date): Promise<void>;
  limparFalha(lojaId: string): Promise<void>;
  /** Medidas de cada produto e da categoria dele. */
  medidasDosItens(itemIds: string[]): Promise<Map<string, { produto: Medidas; categoria: Medidas }>>;
  /** Remetente da etiqueta: nome, telefone e endereço da loja. */
  remetente(lojaId: string): Promise<PontaDoEnvio | null>;
}
