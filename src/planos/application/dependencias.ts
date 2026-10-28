import type { IdempotencyRepository } from '../../shared/idempotency/idempotency.repository.js';
import type { AssinaturasRepository } from './ports/assinaturas.repository.js';
import type { MensageiroAssinatura } from './ports/avisos-assinatura.js';
import type { GatewayAssinaturas } from './ports/gateway-assinaturas.js';

export interface PlanosDeps {
  repo: AssinaturasRepository;
  mensageiro: MensageiroAssinatura;
  /** Mercado Pago Assinaturas na conta do ZapMenu. Sem ele, assinar e mudar de plano ficam indisponíveis. */
  gateway?: GatewayAssinaturas;
  /** Notificações de assinatura já tratadas (o Mercado Pago reenvia). */
  idempotency?: IdempotencyRepository;
  /** Página dos planos na landing, mandada nos convites de upgrade. */
  linkDosPlanos?: string;
}
