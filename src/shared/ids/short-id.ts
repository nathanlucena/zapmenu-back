import { randomInt } from 'node:crypto';

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function gerarCodigoPedido(): string {
  let sufixo = '';
  for (let i = 0; i < 4; i++) {
    sufixo += ALFABETO[randomInt(0, ALFABETO.length)];
  }
  return `PED-${sufixo}`;
}
