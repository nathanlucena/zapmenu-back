import type { Promocao } from '../domain/promocao.js';
import type { LojaDasPromocoes, PromocoesRepository } from '../application/ports/promocoes.repository.js';

export type PromocoesRepositoryFake = PromocoesRepository & {
  promocoes: Promocao[];
  definirLoja(identificador: string, loja: LojaDasPromocoes): void;
};

export function criarPromocoesRepositoryFake(): PromocoesRepositoryFake {
  const lojas = new Map<string, LojaDasPromocoes>();
  let proximo = 1;
  const fake: PromocoesRepositoryFake = {
    promocoes: [],
    definirLoja: (identificador, loja) => lojas.set(identificador, loja),
    async lojaDe(identificador) {
      return lojas.get(identificador) ?? null;
    },
    async listar(lojaId) {
      return fake.promocoes.filter((promocao) => promocao.lojaId === lojaId).map((promocao) => ({ ...promocao }));
    },
    async criar(lojaId, nova) {
      const criada: Promocao = { ...nova, id: `promo-${proximo++}`, lojaId, ativa: true, criadaEm: new Date() };
      fake.promocoes.push(criada);
      return { ...criada };
    },
    async definirAtiva(lojaId, promocaoId, ativa) {
      const promocao = fake.promocoes.find((candidata) => candidata.id === promocaoId && candidata.lojaId === lojaId);
      if (promocao) promocao.ativa = ativa;
    },
    async remover(lojaId, promocaoId) {
      fake.promocoes = fake.promocoes.filter((promocao) => !(promocao.id === promocaoId && promocao.lojaId === lojaId));
    },
    async listarVencidas(agora) {
      return fake.promocoes
        .filter((promocao) => promocao.fim && promocao.fim < agora && (promocao.ativa || !promocao.avisoFimEm))
        .map((promocao) => ({ loja: [...lojas.values()].find((loja) => loja.lojaId === promocao.lojaId)!, promocao: { ...promocao } }));
    },
    async marcarAvisoFim(promocaoId, em) {
      const promocao = fake.promocoes.find((candidata) => candidata.id === promocaoId);
      if (promocao) promocao.avisoFimEm = em;
    },
  };
  return fake;
}
