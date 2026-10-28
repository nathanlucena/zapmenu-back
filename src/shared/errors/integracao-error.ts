export type ServicoExterno = 'mercado_pago' | 'viacep' | 'google' | 'transcricao' | 'deepseek' | 'melhor_envio';

/**
 * Falha ao falar com um serviço de fora (Mercado Pago, ViaCEP, Google). Diz
 * qual serviço e se vale tentar de novo (fora do ar, sobrecarga, timeout) ou
 * não (requisição recusada, chave inválida).
 */
export class IntegracaoError extends Error {
  constructor(
    public readonly servico: ServicoExterno,
    message: string,
    public readonly tentarDeNovo: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'IntegracaoError';
  }
}

/** Resposta HTTP de erro: 5xx e 429 valem nova tentativa; o resto é problema da requisição. */
export function falhaHttp(servico: ServicoExterno, status: number, descricao: string): IntegracaoError {
  return new IntegracaoError(servico, `${descricao} (HTTP ${status}).`, status >= 500 || status === 429);
}

/** Faz a chamada e transforma rede caída e timeout em IntegracaoError (sempre vale tentar de novo). */
export async function chamarServico(
  servico: ServicoExterno,
  descricao: string,
  chamada: () => Promise<Response>,
): Promise<Response> {
  try {
    return await chamada();
  } catch (erro) {
    const timeout = erro instanceof Error && (erro.name === 'TimeoutError' || erro.name === 'AbortError');
    throw new IntegracaoError(servico, `${descricao}: ${timeout ? 'tempo esgotado' : 'sem conexão'}.`, true, {
      cause: erro,
    });
  }
}
