import { describe, expect, it } from 'vitest';
import { IntegracaoError } from '../../shared/errors/integracao-error.js';
import { GEO_AURORA } from './__mocks__/endereco.fake.js';
import type { Geocodificador, ResultadoGeocodificacao } from './endereco.types.js';
import { comCacheELimite } from './geocodificador-economico.js';

const DIA_MS = 24 * 60 * 60 * 1000;

function googleFake(resposta: ResultadoGeocodificacao | null | 'erro' = GEO_AURORA) {
  const buscas: string[] = [];
  const geocodificador: Geocodificador = {
    async geocodificar(endereco) {
      buscas.push(endereco);
      if (resposta === 'erro') {
        throw new Error('Google fora do ar');
      }
      return resposta;
    },
  };
  return { geocodificador, buscas };
}

describe('comCacheELimite', () => {
  it('a mesma busca (com outra caixa ou espaços) sai do cache', async () => {
    const google = googleFake();
    const economico = comCacheELimite(google.geocodificador, { limiteDiario: 10 });

    expect(await economico.geocodificar('Rua da Aurora, 123, Recife')).toEqual(GEO_AURORA);
    expect(await economico.geocodificar('  rua da aurora,  123, RECIFE ')).toEqual(GEO_AURORA);
    expect(google.buscas).toHaveLength(1);
    expect(economico.consultasHoje()).toBe(1);
  });

  it('buscas iguais ao mesmo tempo viram uma consulta', async () => {
    const google = googleFake();
    const economico = comCacheELimite(google.geocodificador, { limiteDiario: 10 });

    await Promise.all([economico.geocodificar('Rua A, 1'), economico.geocodificar('Rua A, 1')]);
    expect(google.buscas).toHaveLength(1);
  });

  it('"não encontrado" também fica guardado, mas por um dia', async () => {
    let agora = Date.UTC(2026, 9, 22, 15);
    const google = googleFake(null);
    const economico = comCacheELimite(google.geocodificador, { limiteDiario: 10, agora: () => agora });

    expect(await economico.geocodificar('Rua Inexistente, 1')).toBeNull();
    expect(await economico.geocodificar('Rua Inexistente, 1')).toBeNull();
    expect(google.buscas).toHaveLength(1);

    agora += DIA_MS + 1;
    await economico.geocodificar('Rua Inexistente, 1');
    expect(google.buscas).toHaveLength(2);
  });

  it('a coordenada vale 30 dias', async () => {
    let agora = Date.UTC(2026, 9, 22, 15);
    const google = googleFake();
    const economico = comCacheELimite(google.geocodificador, { limiteDiario: 0, agora: () => agora });

    await economico.geocodificar('Rua A, 1');
    agora += 29 * DIA_MS;
    await economico.geocodificar('Rua A, 1');
    expect(google.buscas).toHaveLength(1);

    agora += 2 * DIA_MS;
    await economico.geocodificar('Rua A, 1');
    expect(google.buscas).toHaveLength(2);
  });

  it('erro do Google não fica guardado', async () => {
    const google = googleFake('erro');
    const economico = comCacheELimite(google.geocodificador, { limiteDiario: 10 });

    await expect(economico.geocodificar('Rua A, 1')).rejects.toThrow('fora do ar');
    await expect(economico.geocodificar('Rua A, 1')).rejects.toThrow('fora do ar');
    expect(google.buscas).toHaveLength(2);
  });

  it('passou do limite do dia: recusa sem chamar o Google, e libera no dia seguinte', async () => {
    // 22/10 10h no Pacífico (17h UTC).
    let agora = Date.UTC(2026, 9, 22, 17);
    const google = googleFake();
    const economico = comCacheELimite(google.geocodificador, { limiteDiario: 2, agora: () => agora });

    await economico.geocodificar('Rua A, 1');
    await economico.geocodificar('Rua B, 2');
    const recusa = economico.geocodificar('Rua C, 3');
    await expect(recusa).rejects.toBeInstanceOf(IntegracaoError);
    await expect(recusa).rejects.toMatchObject({ servico: 'google', tentarDeNovo: false });
    expect(google.buscas).toHaveLength(2);

    // O que já está no cache continua respondendo.
    expect(await economico.geocodificar('Rua A, 1')).toEqual(GEO_AURORA);

    // Meia-noite no Pacífico (7h UTC do dia 23): a cota do Google e o limite viram juntos.
    agora = Date.UTC(2026, 9, 23, 7, 0, 1);
    await economico.geocodificar('Rua C, 3');
    expect(google.buscas).toHaveLength(3);
    expect(economico.consultasHoje()).toBe(1);
  });

  it('limite 0 não limita', async () => {
    const google = googleFake();
    const economico = comCacheELimite(google.geocodificador, { limiteDiario: 0 });

    for (let i = 0; i < 5; i++) {
      await economico.geocodificar(`Rua ${i}, 1`);
    }
    expect(google.buscas).toHaveLength(5);
  });
});
