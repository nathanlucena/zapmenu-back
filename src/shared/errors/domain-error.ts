/** Categoria do erro, para a borda (HTTP, WhatsApp) decidir como responder. */
/** INDISPONIVEL: um serviço de fora (ex.: mapa) falhou; tentar de novo pode dar certo. */
export type TipoErroDominio = 'REGRA_VIOLADA' | 'NAO_ENCONTRADO' | 'CONFLITO' | 'INDISPONIVEL';

export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly tipo: TipoErroDominio = 'REGRA_VIOLADA',
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
