import { logger } from '../../shared/logger/logger.js';
import { enviarRelatoriosAgendados, type RelatoriosDeps } from '../application/relatorios.js';

export async function executarCicloRelatorios(deps: RelatoriosDeps): Promise<void> {
  await enviarRelatoriosAgendados(deps);
}

/** Confere de tempos em tempos se chegou a hora do semanal ou do diário de cada loja. */
export function iniciarJobRelatorios(deps: RelatoriosDeps, intervaloMs: number): NodeJS.Timeout {
  return setInterval(() => {
    executarCicloRelatorios(deps).catch((erro: unknown) => {
      logger.error({ err: erro }, 'falha no envio dos relatórios agendados');
    });
  }, intervaloMs);
}
