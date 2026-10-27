import { iniciarTeste, type Assinatura } from '../domain/assinatura.js';
import type { AssinaturasRepository, LojaDaAssinatura } from '../application/ports/assinaturas.repository.js';

export type AssinaturasRepositoryFake = AssinaturasRepository & {
  /** Cadastra uma loja (o telefone também serve de identificador, como na gestão). */
  definirLoja(loja: Partial<LojaDaAssinatura> & { empreendedorId: string }, assinatura?: Partial<Assinatura>): void;
  registrarVenda(empreendedorId: string, em?: Date): void;
  definirProdutos(empreendedorId: string, total: number): void;
  assinaturaDe(empreendedorId: string): Assinatura | undefined;
};

export function criarAssinaturasRepositoryFake(): AssinaturasRepositoryFake {
  const lojas = new Map<string, LojaDaAssinatura>();
  const assinaturas = new Map<string, Assinatura>();
  const vendas = new Map<string, Date[]>();
  const produtos = new Map<string, number>();
  const cotas = new Map<string, number>();

  const lojaDe = (identificador: string) =>
    lojas.get(identificador) ?? [...lojas.values()].find((loja) => loja.telefone === identificador);
  const copia = (assinatura: Assinatura | undefined) => assinatura && { ...assinatura };

  return {
    definirLoja(loja, assinatura) {
      const completa: LojaDaAssinatura = { telefone: loja.empreendedorId, fuso: 'America/Sao_Paulo', ...loja };
      lojas.set(completa.empreendedorId, completa);
      if (assinatura) {
        assinaturas.set(completa.empreendedorId, {
          ...iniciarTeste(completa.empreendedorId, new Date()),
          ...assinatura,
          empreendedorId: completa.empreendedorId,
        });
      }
    },
    registrarVenda(empreendedorId, em = new Date()) {
      vendas.set(empreendedorId, [...(vendas.get(empreendedorId) ?? []), em]);
    },
    definirProdutos(empreendedorId, total) {
      produtos.set(empreendedorId, total);
    },
    assinaturaDe: (empreendedorId) => copia(assinaturas.get(empreendedorId)),

    async obter(identificador) {
      const loja = lojaDe(identificador);
      return loja ? { loja, assinatura: copia(assinaturas.get(loja.empreendedorId)) } : null;
    },
    async obterOuIniciarTeste(identificador, agora) {
      const loja = lojaDe(identificador);
      if (!loja) {
        return null;
      }
      if (!assinaturas.has(loja.empreendedorId)) {
        assinaturas.set(loja.empreendedorId, iniciarTeste(loja.empreendedorId, agora));
      }
      return { loja, assinatura: copia(assinaturas.get(loja.empreendedorId))! };
    },
    async porPreapproval(mpPreapprovalId) {
      const assinatura = [...assinaturas.values()].find((candidata) => candidata.mpPreapprovalId === mpPreapprovalId);
      return assinatura ? { loja: lojas.get(assinatura.empreendedorId)!, assinatura: copia(assinatura)! } : null;
    },
    async salvar(assinatura) {
      assinaturas.set(assinatura.empreendedorId, { ...assinatura });
    },
    async listarParaVerificar() {
      return [...assinaturas.values()]
        .filter((assinatura) => ['TESTE', 'PENDENTE', 'CANCELADA'].includes(assinatura.status))
        .map((assinatura) => ({ loja: lojas.get(assinatura.empreendedorId)!, assinatura: copia(assinatura)! }));
    },
    async contarVendas(empreendedorId, de, ate) {
      return (vendas.get(empreendedorId) ?? []).filter((data) => data >= de && data < ate).length;
    },
    async contarProdutos(empreendedorId) {
      return produtos.get(empreendedorId) ?? 0;
    },
    async usoDaCota(empreendedorId, chave, mes) {
      return cotas.get(`${empreendedorId}:${chave}:${mes}`) ?? 0;
    },
    async somarUsoDaCota(empreendedorId, chave, mes, quantidade) {
      const chaveDoMapa = `${empreendedorId}:${chave}:${mes}`;
      cotas.set(chaveDoMapa, (cotas.get(chaveDoMapa) ?? 0) + quantidade);
    },
  };
}
