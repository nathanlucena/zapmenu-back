import { describe, expect, it } from 'vitest';
import { lojaAberta, type HorarioFuncionamento } from './domain/horario-loja.js';

// 2026-10-19 é uma segunda-feira. Horários em São Paulo (UTC-3).
const em = (dataHoraLocal: string) => new Date(`${dataHoraLocal}-03:00`);

describe('lojaAberta', () => {
  const jantar: HorarioFuncionamento[] = [{ dia: 'seg', abre: '18:00', fecha: '23:00' }];

  it('sem horários cadastrados a loja não tem restrição', () => {
    expect(lojaAberta([], em('2026-10-19T04:00'))).toBe(true);
  });

  it('abre no horário de abertura e fecha no de fechamento', () => {
    expect(lojaAberta(jantar, em('2026-10-19T17:59'))).toBe(false);
    expect(lojaAberta(jantar, em('2026-10-19T18:00'))).toBe(true);
    expect(lojaAberta(jantar, em('2026-10-19T22:59'))).toBe(true);
    expect(lojaAberta(jantar, em('2026-10-19T23:00'))).toBe(false);
  });

  it('fica fechada nos dias que não aparecem', () => {
    expect(lojaAberta(jantar, em('2026-10-20T19:00'))).toBe(false);
  });

  it('horário que vira a madrugada vale até o fechamento do dia seguinte', () => {
    const madrugada: HorarioFuncionamento[] = [{ dia: 'sex', abre: '18:00', fecha: '02:00' }];
    expect(lojaAberta(madrugada, em('2026-10-23T23:30'))).toBe(true);
    expect(lojaAberta(madrugada, em('2026-10-24T01:59'))).toBe(true);
    expect(lojaAberta(madrugada, em('2026-10-24T02:00'))).toBe(false);
    // Na quinta de madrugada não: o horário é de sexta.
    expect(lojaAberta(madrugada, em('2026-10-23T01:00'))).toBe(false);
  });

  it('fechar à meia-noite conta como fim do dia', () => {
    expect(lojaAberta([{ dia: 'seg', abre: '18:00', fecha: '00:00' }], em('2026-10-19T23:59'))).toBe(true);
  });

  it('usa o fuso da loja, não o do servidor', () => {
    // 21:30 em São Paulo = 00:30 UTC de terça.
    expect(lojaAberta(jantar, new Date('2026-10-20T00:30:00Z'))).toBe(true);
    expect(lojaAberta(jantar, new Date('2026-10-20T00:30:00Z'), 'UTC')).toBe(false);
  });
});
