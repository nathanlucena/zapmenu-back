import { logger } from '../../shared/logger/logger.js';
import type { PlanosDeps } from '../application/dependencias.js';
import { verificarAssinaturas } from '../application/verificar-assinaturas.js';

export async function executarCicloAssinaturas(deps: Pick<PlanosDeps, 'repo' | 'mensageiro' | 'linkDosPlanos'>): Promise<void> {
  await verificarAssinaturas(deps);
}

/** Espera a sessão de gestão conectar antes da primeira rodada: aviso marcado e não enviado se perderia. */
const ESPERA_NO_BOOT_MS = 2 * 60_000;

/**
 * Job diário das assinaturas. Roda pouco depois do boot e depois a cada
 * intervalo (padrão 1 h): como cada aviso sai uma vez por dia, rodar mais
 * vezes só garante que um reinício do processo não faça a loja perder o aviso do dia.
 */
export function iniciarJobAssinaturas(
  deps: Pick<PlanosDeps, 'repo' | 'mensageiro' | 'linkDosPlanos'>,
  intervaloMs: number,
): NodeJS.Timeout {
  const rodar = () =>
    executarCicloAssinaturas(deps).catch((erro: unknown) => {
      logger.error({ err: erro }, 'falha na verificação das assinaturas');
    });
  setTimeout(rodar, ESPERA_NO_BOOT_MS).unref();
  return setInterval(rodar, intervaloMs);
}
