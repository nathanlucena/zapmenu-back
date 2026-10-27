import { logger } from '../../shared/logger/logger.js';
import type { MensageiroPromocoes } from '../application/ports/avisos-promocao.js';
import type { PromocoesRepository } from '../application/ports/promocoes.repository.js';
import { verificarPromocoesVencidas } from '../application/promocoes.js';

type Deps = { repo: PromocoesRepository; mensageiro: MensageiroPromocoes };

export async function executarCicloPromocoes(deps: Deps): Promise<void> {
  await verificarPromocoesVencidas(deps);
}

/** Desliga as promoções vencidas e avisa o lojista no dia seguinte (cada aviso sai uma vez). */
export function iniciarJobPromocoes(deps: Deps, intervaloMs: number): NodeJS.Timeout {
  return setInterval(() => {
    executarCicloPromocoes(deps).catch((erro: unknown) => {
      logger.error({ err: erro }, 'falha ao verificar as promoções vencidas');
    });
  }, intervaloMs);
}
