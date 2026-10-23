import { describe, expect, it } from 'vitest';
import { cadastroCompleto, descreverObrigatorios, obrigatoriosDaLoja, opcionaisDaLoja } from './cadastro-da-loja.js';

const completa = {
  nome: 'Pizzaria do Zé',
  aceitaRetirada: true,
  fazEntrega: true,
  enderecoConfirmado: true,
  faixasEntrega: [{ ateKm: 2, taxa: 5 }],
  horarios: [{ dia: 'seg', abre: '18:00', fecha: '23:00' }],
};

describe('cadastro da loja', () => {
  it('loja nova não tem nada; o link sai do nome', () => {
    expect(cadastroCompleto(null)).toBe(false);
    expect(obrigatoriosDaLoja({ nome: 'Bolos', enderecoConfirmado: false }).slice(0, 2).map((item) => item.ok)).toEqual([
      true,
      true,
    ]);
  });

  it('as taxas de entrega só são obrigatórias para quem entrega', () => {
    expect(obrigatoriosDaLoja(completa)).toHaveLength(6);
    expect(obrigatoriosDaLoja({ ...completa, fazEntrega: false, faixasEntrega: [] })).toHaveLength(5);
    expect(cadastroCompleto({ ...completa, faixasEntrega: [] })).toBe(false);
    expect(cadastroCompleto({ ...completa, fazEntrega: false, faixasEntrega: [] })).toBe(true);
  });

  it('sem endereço confirmado ou sem horário não fica completo', () => {
    expect(cadastroCompleto(completa)).toBe(true);
    expect(cadastroCompleto({ ...completa, enderecoConfirmado: false })).toBe(false);
    expect(cadastroCompleto({ ...completa, horarios: [] })).toBe(false);
  });

  it('mostra o progresso com ✅ e ⬜', () => {
    expect(descreverObrigatorios({ nome: 'Bolos', aceitaRetirada: true, enderecoConfirmado: false })).toBe(
      [
        '📋 *Cadastro da loja* (3 de 5)',
        '✅ Nome da loja',
        '✅ Link do cardápio',
        '✅ Como entrega (retirada, entrega ou os dois)',
        '⬜ Endereço da loja confirmado',
        '⬜ Horário de funcionamento',
      ].join('\n'),
    );
  });

  it('opcionais: descrição, logo, capa, cor, pedido mínimo e Instagram', () => {
    const faltando = opcionaisDaLoja({ ...completa, corDestaque: '#C2410C' }).filter((item) => !item.ok);
    expect(faltando.map((item) => item.rotulo)).toEqual(['Descrição da loja', 'Logo', 'Foto de capa', 'Pedido mínimo', 'Instagram']);
  });
});
