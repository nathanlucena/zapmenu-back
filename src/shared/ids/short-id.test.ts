import { describe, expect, it } from 'vitest';
import { gerarCodigoPedido } from './short-id.js';

describe('gerarCodigoPedido', () => {
  it('gera código no formato PED-XXXX', () => {
    expect(gerarCodigoPedido()).toMatch(/^PED-[A-Z0-9]{4}$/);
  });

  it('não repete o mesmo valor em chamadas sucessivas (probabilisticamente)', () => {
    const codigos = new Set(Array.from({ length: 20 }, () => gerarCodigoPedido()));
    expect(codigos.size).toBeGreaterThan(1);
  });
});
