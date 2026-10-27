import { describe, expect, it } from 'vitest';
import {
  aplicarPromocao,
  descreverDias,
  melhorPromocao,
  promocaoValeAgora,
  rotuloDaPromocao,
  type Promocao,
} from './domain/promocao.js';

const FUSO = 'America/Sao_Paulo';

function promocao(dados: Partial<Promocao> = {}): Promocao {
  return {
    id: 'p1',
    lojaId: 'loja-1',
    tipo: 'PRECO_FIXO',
    valor: 39.9,
    diasSemana: [3, 4],
    ativa: true,
    alvo: { tipo: 'ITENS', ids: ['calabresa'] },
    criadaEm: new Date('2026-10-01T12:00:00Z'),
    ...dados,
  };
}

// 28/10/2026 é uma quarta-feira.
const QUARTA_20H = new Date('2026-10-28T23:00:00Z'); // 20h em São Paulo
const TERCA_20H = new Date('2026-10-27T23:00:00Z');
const CALABRESA = { id: 'calabresa', categoriaId: 'pizzas', preco: 50 };

describe('quando a promoção vale', () => {
  it('dia sem promoção e dia com promoção', () => {
    expect(promocaoValeAgora(promocao(), TERCA_20H, FUSO)).toBe(false);
    expect(promocaoValeAgora(promocao(), QUARTA_20H, FUSO)).toBe(true);
  });

  it('a virada do dia é a de São Paulo, não a do UTC', () => {
    // Quinta 01h UTC = quarta 22h em São Paulo: vale como quarta.
    expect(promocaoValeAgora(promocao({ diasSemana: [3] }), new Date('2026-10-29T01:00:00Z'), FUSO)).toBe(true);
    // Quarta 02h UTC = terça 23h em São Paulo: ainda não é quarta.
    expect(promocaoValeAgora(promocao({ diasSemana: [3] }), new Date('2026-10-28T02:00:00Z'), FUSO)).toBe(false);
  });

  it('horário: dentro, fora e virando a madrugada (conta para o dia em que começou)', () => {
    const almoco = promocao({ horaInicio: '11:00', horaFim: '14:00' });
    expect(promocaoValeAgora(almoco, new Date('2026-10-28T15:00:00Z'), FUSO)).toBe(true); // 12h
    expect(promocaoValeAgora(almoco, QUARTA_20H, FUSO)).toBe(false);

    const noite = promocao({ diasSemana: [3], horaInicio: '22:00', horaFim: '02:00' });
    expect(promocaoValeAgora(noite, new Date('2026-10-29T04:00:00Z'), FUSO)).toBe(true); // quinta 01h
    expect(promocaoValeAgora(noite, new Date('2026-10-30T04:00:00Z'), FUSO)).toBe(false); // sexta 01h
  });

  it('vencida, ainda não começou ou pausada não vale', () => {
    expect(promocaoValeAgora(promocao({ fim: new Date('2026-10-28T12:00:00Z') }), QUARTA_20H, FUSO)).toBe(false);
    expect(promocaoValeAgora(promocao({ inicio: new Date('2026-11-01T00:00:00Z') }), QUARTA_20H, FUSO)).toBe(false);
    expect(promocaoValeAgora(promocao({ ativa: false }), QUARTA_20H, FUSO)).toBe(false);
  });

  it('sem dias = todos os dias', () => {
    expect(promocaoValeAgora(promocao({ diasSemana: [] }), TERCA_20H, FUSO)).toBe(true);
  });
});

describe('preço com a promoção', () => {
  it('percentual arredonda para baixo no centavo', () => {
    expect(aplicarPromocao(49.9, { tipo: 'PERCENTUAL', valor: 15 })).toBe(42.41); // 42,415
    expect(aplicarPromocao(10, { tipo: 'PERCENTUAL', valor: 33 })).toBe(6.7);
    expect(aplicarPromocao(50, { tipo: 'PERCENTUAL', valor: 10 })).toBe(45);
  });

  it('com mais de uma promoção, vale o menor preço, sem acumular', () => {
    const fixa = promocao();
    const dez = promocao({ id: 'p2', tipo: 'PERCENTUAL', valor: 10, diasSemana: [], alvo: { tipo: 'LOJA' } });
    const trinta = promocao({ id: 'p3', tipo: 'PERCENTUAL', valor: 30, diasSemana: [], alvo: { tipo: 'CATEGORIAS', ids: ['pizzas'] } });

    expect(melhorPromocao(CALABRESA, [fixa, dez], QUARTA_20H, FUSO)).toMatchObject({ preco: 39.9, desconto: { promocaoId: 'p1' } });
    expect(melhorPromocao(CALABRESA, [fixa, dez, trinta], QUARTA_20H, FUSO)).toMatchObject({ preco: 35, desconto: { rotulo: '-30%' } });
    expect(melhorPromocao(CALABRESA, [fixa, dez], TERCA_20H, FUSO)).toMatchObject({ preco: 45 });
  });

  it('item fora do alvo, ou preço fixo maior que o normal, fica sem promoção', () => {
    expect(melhorPromocao({ id: 'mussarela', preco: 50 }, [promocao()], QUARTA_20H, FUSO)).toBeUndefined();
    expect(melhorPromocao({ ...CALABRESA, preco: 35 }, [promocao()], QUARTA_20H, FUSO)).toBeUndefined();
  });
});

describe('textos', () => {
  it('selo e dias', () => {
    expect(rotuloDaPromocao(promocao({ diasSemana: [3] }))).toBe('Promoção de quarta');
    expect(rotuloDaPromocao(promocao())).toBe('Promoção');
    expect(rotuloDaPromocao(promocao({ tipo: 'PERCENTUAL', valor: 10 }))).toBe('-10%');
    expect(descreverDias([4, 3])).toBe('quarta e quinta');
    expect(descreverDias([])).toBe('todos os dias');
    expect(descreverDias([1, 3, 5])).toBe('segunda, quarta e sexta');
  });
});
