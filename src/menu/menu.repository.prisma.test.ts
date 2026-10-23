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
    politicaTroca: null,
    cepOrigem: null,
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

  it('mostra a política de troca, mas não o CEP de origem', () => {
    const loja = paraLojaPublica(lojaSalva({ politicaTroca: 'Troca em até 7 dias com etiqueta.', cepOrigem: '50000-000' }));

    expect(loja.politicaTroca).toBe('Troca em até 7 dias com etiqueta.');
    expect(JSON.stringify(loja)).not.toContain('50000-000');
  });
});
