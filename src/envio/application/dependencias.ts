import type { MensageiroMelhorEnvio } from './ports/avisos-melhor-envio.js';
import type { ContasMelhorEnvioRepository } from './ports/contas-melhor-envio.repository.js';
import type { GatewayMelhorEnvio } from './ports/gateway-melhor-envio.js';

export interface MelhorEnvioDeps {
  gateway: GatewayMelhorEnvio;
  contas: ContasMelhorEnvioRepository;
  mensageiro: MensageiroMelhorEnvio;
  /** Assina o `state` do OAuth: o retorno só vale para a loja que pediu o link. */
  segredo: string;
  relogio?: () => Date;
}
