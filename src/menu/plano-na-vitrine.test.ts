import { describe, expect, it } from 'vitest';
import type { CardapioPublico, LojaPublica } from './menu.types.js';
import { cardapioNoPlano, lojaNoPlano, regrasNoPlano } from './plano-na-vitrine.js';
import { REGRAS_PADRAO } from './__mocks__/menu.repository.fake.js';

const LOJA: LojaPublica = {
  nome: 'Pizzaria do Zé',
  segmento: 'COMIDA',
  aceitaRetirada: true,
  fazEntrega: true,
  faixasEntrega: [{ ateKm: 3, taxa: 5 }],
  horarios: [],
  fuso: 'America/Sao_Paulo',
  corDestaque: '#C62828',
  capaUrl: 'data:image/png;base64,CAPA',
  logoUrl: 'data:image/png;base64,LOGO',
};

const BASICO = { plano: 'ESSENCIAL', status: 'ATIVA' } as const;
const PROFISSIONAL = { plano: 'PROFISSIONAL', status: 'ATIVA' } as const;

describe('vitrine no plano da loja', () => {
  it('Básico: com o selo, sem cor e capa (o logo fica)', () => {
    const loja = lojaNoPlano(LOJA, BASICO);
    expect(loja).toMatchObject({ mostrarSelo: true, logoUrl: LOJA.logoUrl });
    expect(loja.corDestaque).toBeUndefined();
    expect(loja.capaUrl).toBeUndefined();
    expect(loja.indisponivel).toBeUndefined();
  });

  it('Profissional e TESTE: sem selo e com tudo o que a loja configurou', () => {
    for (const plano of [PROFISSIONAL, { plano: 'ESSENCIAL', status: 'TESTE' } as const, undefined]) {
      expect(lojaNoPlano(LOJA, plano)).toMatchObject({
        mostrarSelo: false,
        corDestaque: '#C62828',
        capaUrl: LOJA.capaUrl,
      });
    }
  });

  it('suspensa: indisponível e sem o catálogo', () => {
    const cardapio: CardapioPublico = {
      loja: LOJA,
      secoes: [{ id: null, nome: 'Outros', itens: [] }],
      itens: [],
    };
    const suspenso = cardapioNoPlano(cardapio, { plano: 'PROFISSIONAL', status: 'SUSPENSA' });
    expect(suspenso.loja).toMatchObject({ indisponivel: true, nome: 'Pizzaria do Zé' });
    expect(suspenso.secoes).toEqual([]);
  });

  it('pendente e cancelada continuam no ar', () => {
    for (const status of ['PENDENTE', 'CANCELADA'] as const) {
      expect(lojaNoPlano(LOJA, { plano: 'PROFISSIONAL', status }).indisponivel).toBeUndefined();
    }
  });

  it('regras de pedido: suspensa não recebe pedido', () => {
    const regras = { ...REGRAS_PADRAO, fazEntrega: true };
    expect(regrasNoPlano(regras, PROFISSIONAL).indisponivel).toBeUndefined();
    expect(regrasNoPlano(regras, { plano: 'ESSENCIAL', status: 'SUSPENSA' }).indisponivel).toBe(true);
  });
});
