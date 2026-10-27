import { Prisma, type Loja } from '@prisma/client';
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
    segmentoDefinido: true,
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
    raioEntregaKm: null,
    modoEntrega: 'DISTANCIA',
    pedidoMinimo: null,
    horarios: [],
    slug: 'bolos-da-dona',
    capaUrl: null,
    logoUrl: null,
    corDestaque: null,
    instagram: null,
    lembreteOpcionaisEm: null,
    naoLembrarOpcionais: false,
    fuso: 'America/Sao_Paulo',
    politicaTroca: null,
    cepOrigem: null,
    usaMelhorEnvio: false,
    avisarFimDoFreteFixo: false,
    relatorioDiario: true,
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
    const loja = paraLojaPublica(
      lojaSalva({ segmento: 'VAREJO', politicaTroca: 'Troca em até 7 dias com etiqueta.', cepOrigem: '50000-000' }),
    );

    expect(loja.politicaTroca).toBe('Troca em até 7 dias com etiqueta.');
    expect(JSON.stringify(loja)).not.toContain('50000-000');
  });

  it('no tipo Cardápio, política de troca e Melhor Envio ficam ocultos (sem apagar)', () => {
    const ligado = { politicaTroca: 'Troca em 7 dias.', usaMelhorEnvio: true, cepOrigem: '50050000' };
    const profissional = { plano: 'PROFISSIONAL', status: 'ATIVA' } as const;

    const cardapio = paraLojaPublica(lojaSalva(ligado), profissional, true);
    expect(cardapio.politicaTroca).toBeUndefined();
    expect(cardapio.melhorEnvio).toBe(false);

    expect(paraLojaPublica(lojaSalva({ ...ligado, segmento: 'VAREJO' }), profissional, true).melhorEnvio).toBe(true);
    // Sem a conta conectada ou fora do Profissional, não oferece.
    expect(paraLojaPublica(lojaSalva({ ...ligado, segmento: 'VAREJO' }), profissional, false).melhorEnvio).toBe(false);
    expect(paraLojaPublica(lojaSalva({ ...ligado, segmento: 'VAREJO' }), { plano: 'ESSENCIAL', status: 'ATIVA' }, true).melhorEnvio).toBe(false);
  });
});

describe('paraLojaPublica: entrega no plano da loja', () => {
  const BASICO = { plano: 'ESSENCIAL', status: 'ATIVA' } as const;
  const PROFISSIONAL = { plano: 'PROFISSIONAL', status: 'ATIVA' } as const;
  const comEndereco = { latitude: new Prisma.Decimal(-8.05), longitude: new Prisma.Decimal(-34.9) };
  const porDistancia = { ...comEndereco, fazEntrega: true, faixasEntrega: [{ ateKm: 3, taxa: 5 }] };

  it('Básico com taxa fixa: entrega com o valor e o raio', () => {
    const loja = paraLojaPublica(
      lojaSalva({ ...comEndereco, fazEntrega: true, modoEntrega: 'FIXA', taxaEntrega: new Prisma.Decimal(6), raioEntregaKm: new Prisma.Decimal(4) }),
      BASICO,
    );
    expect(loja).toMatchObject({ fazEntrega: true, taxaEntrega: 6, raioMaximoKm: 4, faixasEntrega: [] });
  });

  it('Básico: entrega por distância barrada; sem taxa fixa, só retirada (as faixas ficam guardadas)', () => {
    const loja = paraLojaPublica(lojaSalva(porDistancia), BASICO);
    expect(loja).toMatchObject({ fazEntrega: false, faixasEntrega: [] });
    expect(loja.taxaEntrega).toBeUndefined();
  });

  it('caiu do Profissional para o Básico com uma taxa fixa guardada: passa a usar a taxa fixa', () => {
    const loja = paraLojaPublica(lojaSalva({ ...porDistancia, taxaEntrega: new Prisma.Decimal(7) }), BASICO);
    expect(loja).toMatchObject({ fazEntrega: true, taxaEntrega: 7, faixasEntrega: [] });
  });

  it('Profissional escolhe: por distância (a taxa fixa guardada não aparece) ou taxa fixa', () => {
    const distancia = paraLojaPublica(lojaSalva({ ...porDistancia, taxaEntrega: new Prisma.Decimal(7) }), PROFISSIONAL);
    expect(distancia).toMatchObject({ fazEntrega: true, faixasEntrega: [{ ateKm: 3, taxa: 5 }], raioMaximoKm: 3 });
    expect(distancia.taxaEntrega).toBeUndefined();

    const fixa = paraLojaPublica(lojaSalva({ ...porDistancia, modoEntrega: 'FIXA', taxaEntrega: new Prisma.Decimal(7) }), PROFISSIONAL);
    expect(fixa).toMatchObject({ fazEntrega: true, taxaEntrega: 7, faixasEntrega: [] });
  });

  it('Básico pede a taxa fixa no cadastro (e não as faixas)', () => {
    const semTaxa = lojaSalva({ ...porDistancia, horarios: [{ dia: 'seg', abre: '18:00', fecha: '23:00' }] });
    expect(paraLojaPublica(semTaxa, BASICO).emMontagem).toBe(true);
    expect(paraLojaPublica(semTaxa, PROFISSIONAL).emMontagem).toBe(false);
    expect(paraLojaPublica({ ...semTaxa, taxaEntrega: new Prisma.Decimal(5) }, BASICO).emMontagem).toBe(false);
  });
});
