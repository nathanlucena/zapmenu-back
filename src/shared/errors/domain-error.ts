/** Categoria do erro, para a borda (HTTP, WhatsApp) decidir como responder. */
export type TipoErroDominio = 'REGRA_VIOLADA' | 'NAO_ENCONTRADO' | 'CONFLITO';

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
