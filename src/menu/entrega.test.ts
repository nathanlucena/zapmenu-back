import { describe, expect, it } from 'vitest';
import type { EnderecoVerificado } from './conversation/conversation-state.types.js';
import { calcularEntrega, distanciaKm, raioMaximoKm, validarFaixas } from './entrega.js';

const LOJA_COORD = { latitude: -8.0591, longitude: -34.8798 };
const ENDERECO: EnderecoVerificado = {
  numero: '123',
  enderecoFormatado: 'Rua da Aurora, 123',
  precisao: 'ROOFTOP',
  ...LOJA_COORD,
};
const FAIXAS = [
  { ateKm: 1, taxa: 0 },
  { ateKm: 3, taxa: 5 },
];
/** Ponto a `km` ao norte da loja (1° de latitude ≈ 111,195 km com raio 6.371 km). */
const aoNorte = (km: number) => ({ latitude: LOJA_COORD.latitude + km / 111.19492664, longitude: LOJA_COORD.longitude });

describe('distanciaKm', () => {
  it('calcula a distância em linha reta entre dois pontos conhecidos', () => {
    // Marco Zero (Recife) → Praça da Sé (São Paulo): ~2.130 km em linha reta.
    const recife = { latitude: -8.0631, longitude: -34.8711 };
    const saoPaulo = { latitude: -23.5503, longitude: -46.6339 };
    expect(distanciaKm(recife, saoPaulo)).toBeGreaterThan(2120);
    expect(distanciaKm(recife, saoPaulo)).toBeLessThan(2140);
  });

  it('é zero no mesmo ponto', () => {
    expect(distanciaKm(LOJA_COORD, LOJA_COORD)).toBe(0);
  });
});

describe('calcularEntrega', () => {
  const loja = { fazEntrega: true, enderecoVerificado: ENDERECO, faixasEntrega: FAIXAS };

  it('aplica a primeira faixa que cobre a distância', () => {
    expect(calcularEntrega(loja, aoNorte(0.5))).toMatchObject({ disponivel: true, taxa: 0 });
    expect(calcularEntrega(loja, aoNorte(2))).toMatchObject({ disponivel: true, taxa: 5 });
  });

  it('trata o limite como inclusivo', () => {
    expect(calcularEntrega(loja, aoNorte(0.9999))).toMatchObject({ disponivel: true, taxa: 0 });
    expect(calcularEntrega(loja, aoNorte(2.9999))).toMatchObject({ disponivel: true, taxa: 5 });
  });

  it('recusa acima do maior raio', () => {
    const resultado = calcularEntrega(loja, aoNorte(3.2));
    expect(resultado).toMatchObject({ disponivel: false, motivo: 'FORA_DA_AREA' });
  });

  it('não depende da ordem das faixas', () => {
    const invertida = { ...loja, faixasEntrega: [...FAIXAS].reverse() };
    expect(calcularEntrega(invertida, aoNorte(0.5))).toMatchObject({ disponivel: true, taxa: 0 });
  });

  it.each([
    [{ ...loja, fazEntrega: false }, 'LOJA_SEM_ENTREGA'],
    [{ ...loja, enderecoVerificado: undefined }, 'LOJA_SEM_ENDERECO'],
    [{ ...loja, faixasEntrega: [] }, 'SEM_FAIXAS'],
  ])('indisponível quando a loja não está configurada (%#)', (configuracao, motivo) => {
    expect(calcularEntrega(configuracao, aoNorte(0.5))).toEqual({ disponivel: false, motivo });
  });

  it('loja antiga com taxa fixa e sem faixas não entrega', () => {
    const antiga = { fazEntrega: true, taxaEntrega: 5, enderecoVerificado: undefined, faixasEntrega: [] };
    expect(calcularEntrega(antiga, aoNorte(0.5))).toMatchObject({ disponivel: false });
  });
});

describe('validarFaixas', () => {
  it('ordena sem avisar', () => {
    expect(validarFaixas([...FAIXAS].reverse())).toEqual({ faixas: FAIXAS, avisos: [] });
  });

  it('descarta raio acima do limite, taxa negativa e repetição, com avisos', () => {
    const { faixas, avisos } = validarFaixas([
      { ateKm: 1, taxa: 0 },
      { ateKm: 45, taxa: 10 },
      { ateKm: 2, taxa: -3 },
      { ateKm: 1, taxa: 4 },
      { ateKm: 0, taxa: 2 },
    ]);
    expect(faixas).toEqual([{ ateKm: 1, taxa: 0 }]);
    expect(avisos).toHaveLength(4);
    expect(avisos.join(' ')).toContain('45 km é maior que o limite de 30 km');
  });

  it('recusa mais de 6 faixas', () => {
    const muitas = Array.from({ length: 7 }, (_, i) => ({ ateKm: i + 1, taxa: i }));
    expect(validarFaixas(muitas).faixas).toBeUndefined();
  });

  it('aceita meio quilômetro', () => {
    expect(validarFaixas([{ ateKm: 0.5, taxa: 0 }]).faixas).toEqual([{ ateKm: 0.5, taxa: 0 }]);
  });
});

describe('raioMaximoKm', () => {
  it('é o maior ateKm', () => {
    expect(raioMaximoKm(FAIXAS)).toBe(3);
    expect(raioMaximoKm([])).toBeUndefined();
  });
});
