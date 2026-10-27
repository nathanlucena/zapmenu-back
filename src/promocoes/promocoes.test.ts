import { describe, expect, it } from 'vitest';
import { criarPromocoesRepositoryFake } from './__mocks__/promocoes.repository.fake.js';
import {
  listaDePromocoes,
  problemasDaPromocao,
  resumoDaPromocao,
  verificarPromocoesVencidas,
  type CatalogoParaPromocao,
} from './application/promocoes.js';
import type { NovaPromocao } from './application/ports/promocoes.repository.js';

const FUSO = 'America/Sao_Paulo';
const AGORA = new Date('2026-10-28T15:00:00Z');

const CATALOGO: CatalogoParaPromocao = {
  itens: [
    { id: 'calabresa', nome: 'Calabresa', precoBase: 50, categoriaId: 'pizzas' },
    { id: 'mussarela', nome: 'Mussarela', precoBase: 45.9, categoriaId: 'pizzas' },
    { id: 'portuguesa', nome: 'Portuguesa', precoBase: 52, categoriaId: 'pizzas' },
    { id: 'frango', nome: 'Frango', precoBase: 48, categoriaId: 'pizzas' },
    { id: 'coca', nome: 'Coca 2L', precoBase: 14, categoriaId: 'bebidas' },
  ],
  categorias: [
    { id: 'pizzas', nome: 'Pizzas' },
    { id: 'bebidas', nome: 'Bebidas' },
  ],
};

const DEZ_NAS_PIZZAS: NovaPromocao = { tipo: 'PERCENTUAL', valor: 10, alvo: { tipo: 'CATEGORIAS', ids: ['pizzas'] }, diasSemana: [] };

describe('desconto em %', () => {
  it('resumo: quantos itens, exemplos com o preço arredondado para baixo e o "Confirma?"', () => {
    const resumo = resumoDaPromocao(DEZ_NAS_PIZZAS, CATALOGO, FUSO);
    expect(resumo).toContain('10% de desconto em Pizzas · todos os dias');
    expect(resumo).toContain('4 itens com desconto');
    expect(resumo).toContain('• Calabresa: ~R$ 50,00~ → *R$ 45,00*');
    expect(resumo).toContain('• Mussarela: ~R$ 45,90~ → *R$ 41,31*'); // 41,31
    expect(resumo).toContain('• … e mais 1');
    expect(resumo).not.toContain('Tem certeza');
    expect(resumo).toContain('Confirma?');
  });

  it('loja toda com fim: até o dia, e aviso de desconto alto acima de 50%', () => {
    const resumo = resumoDaPromocao(
      { tipo: 'PERCENTUAL', valor: 60, alvo: { tipo: 'LOJA' }, diasSemana: [], fim: new Date('2026-11-02T02:59:59.999Z') },
      CATALOGO,
      FUSO,
    );
    expect(resumo).toContain('60% de desconto na loja toda · todos os dias · até 01/11');
    expect(resumo).toContain('vou pedir para confirmar duas vezes');
  });

  it('aceita de 1% a 90%', () => {
    const com = (valor: number) => problemasDaPromocao({ ...DEZ_NAS_PIZZAS, valor }, CATALOGO, AGORA);
    expect(com(1)).toEqual([]);
    expect(com(90)).toEqual([]);
    expect(com(0)[0]).toContain('de 1% a 90%');
    expect(com(91)[0]).toContain('de 1% a 90%');
  });

  it('recusa fim no passado, alvo vazio e preço fixo na loja toda', () => {
    expect(problemasDaPromocao({ ...DEZ_NAS_PIZZAS, fim: new Date('2026-10-01T00:00:00Z') }, CATALOGO, AGORA)).toContain('a data de fim já passou');
    expect(problemasDaPromocao({ ...DEZ_NAS_PIZZAS, alvo: { tipo: 'CATEGORIAS', ids: ['sobremesas'] } }, CATALOGO, AGORA)).toContain(
      'não achei nenhum item para essa promoção',
    );
    expect(problemasDaPromocao({ tipo: 'PRECO_FIXO', valor: 10, alvo: { tipo: 'LOJA' }, diasSemana: [] }, CATALOGO, AGORA)[0]).toContain(
      'preço fixo vale para itens',
    );
  });
});

describe('promoção vencida', () => {
  function cenario() {
    const repo = criarPromocoesRepositoryFake();
    repo.definirLoja('5581999990000', { lojaId: 'loja-1', telefone: '5581999990000', fuso: FUSO });
    const enviados: string[] = [];
    const deps = { repo, mensageiro: { enviarTexto: async (_telefone: string, texto: string) => void enviados.push(texto) } };
    return { repo, enviados, deps };
  }

  it('desliga logo que vence e avisa no dia seguinte, a partir das 8h, uma vez só', async () => {
    const { repo, enviados, deps } = cenario();
    // Até domingo 01/11 (fim às 23:59:59 em São Paulo).
    await repo.criar('loja-1', { ...DEZ_NAS_PIZZAS, fim: new Date('2026-11-02T02:59:59.999Z') });

    await verificarPromocoesVencidas(deps, new Date('2026-11-01T20:00:00Z')); // domingo 17h: ainda vale
    expect(repo.promocoes[0]?.ativa).toBe(true);

    await verificarPromocoesVencidas(deps, new Date('2026-11-02T04:00:00Z')); // segunda 01h: venceu
    expect(repo.promocoes[0]?.ativa).toBe(false);
    expect(enviados).toEqual([]);

    await verificarPromocoesVencidas(deps, new Date('2026-11-02T11:00:00Z')); // segunda 08h
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toContain('O desconto de 10% que ia até 01/11 terminou. Os preços voltaram ao normal');

    await verificarPromocoesVencidas(deps, new Date('2026-11-02T15:00:00Z'));
    expect(enviados).toHaveLength(1);
  });

  it('na lista, aparece como encerrada', async () => {
    const { repo } = cenario();
    const criada = await repo.criar('loja-1', { ...DEZ_NAS_PIZZAS, fim: new Date('2026-10-20T02:59:59.999Z') });
    expect(listaDePromocoes([criada], CATALOGO, AGORA, FUSO)).toContain('⌛ encerrada');
  });
});
