import type { Loja } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { paraLojaPublica } from './menu.repository.prisma.js';

/** Uma loja como sai do banco, com os padrões do schema. */
function lojaSalva(dados: Partial<Loja> = {}): Loja {
  return {
    id: 'loja-1',
    empreendedorId: 'emp-1',
    nome: 'Bolos da Dona',
    descricao: null,
    segmento: 'COMIDA',
    endereco: null,
    cep: null,
    logradouro: null,
    numero: null,
    complemento: null,
    bairro: null,
    cidade: null,
    uf: null,
    latitude: null,
    longitude: null,
    precisaoEndereco: null,
    aceitaRetirada: true,
    fazEntrega: false,
    aceitaPagamentoNaEntrega: true,
    faixasEntrega: [],
    taxaEntrega: null,
    pedidoMinimo: null,
    horarios: [],
    slug: 'bolos-da-dona',
    capaUrl: null,
    logoUrl: null,
    corDestaque: null,
    lembreteOpcionaisEm: null,
    naoLembrarOpcionais: false,
    fuso: 'America/Sao_Paulo',
    atualizadoEm: new Date('2026-10-23T12:00:00Z'),
    ...dados,
  };
}

describe('paraLojaPublica', () => {
  it('loja antiga aparece como comida', () => {
    expect(paraLojaPublica(lojaSalva()).segmento).toBe('COMIDA');
  });

  it('mostra o segmento da loja de varejo', () => {
    expect(paraLojaPublica(lojaSalva({ segmento: 'VAREJO' })).segmento).toBe('VAREJO');
  });
});
