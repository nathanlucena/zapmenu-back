import type { LojaDoRelatorio, RelatoriosRepository } from '../application/ports/relatorios.repository.js';
import type { PedidoParaRelatorio } from '../domain/relatorio.js';

export type RelatoriosRepositoryFake = RelatoriosRepository & {
  lojas: LojaDoRelatorio[];
  /** Vendas por empreendedor, com a data em que viraram venda. */
  definirVendas(empreendedorId: string, vendas: (PedidoParaRelatorio & { confirmadoEm: Date })[]): void;
  envios: string[];
};

export function criarRelatoriosRepositoryFake(): RelatoriosRepositoryFake {
  const vendas = new Map<string, (PedidoParaRelatorio & { confirmadoEm: Date })[]>();
  const fake: RelatoriosRepositoryFake = {
    lojas: [],
    envios: [],
    definirVendas: (empreendedorId, lista) => vendas.set(empreendedorId, lista),
    async lojaDe(identificador) {
      return fake.lojas.find((loja) => loja.telefone === identificador || loja.empreendedorId === identificador) ?? null;
    },
    async listarLojas() {
      return fake.lojas.map((loja) => ({ ...loja }));
    },
    async vendas(empreendedorId, { de, ate }) {
      return (vendas.get(empreendedorId) ?? []).filter((venda) => venda.confirmadoEm >= de && venda.confirmadoEm < ate);
    },
    async registrarEnvio(lojaId, tipo, chave) {
      const registro = `${lojaId}:${tipo}:${chave}`;
      if (fake.envios.includes(registro)) return false;
      fake.envios.push(registro);
      return true;
    },
    async definirRelatorioDiario(lojaId, ligado) {
      const loja = fake.lojas.find((candidata) => candidata.lojaId === lojaId);
      if (loja) loja.relatorioDiario = ligado;
    },
  };
  return fake;
}
