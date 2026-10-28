import type {
  AssinaturaNoGateway,
  CobrancaNoGateway,
  GatewayAssinaturas,
  NovaAssinaturaNoGateway,
} from '../application/ports/gateway-assinaturas.js';

/** Mercado Pago Assinaturas de mentira: guarda o que foi pedido e deixa o teste decidir o que ele responde. */
export type GatewayAssinaturasFake = GatewayAssinaturas & {
  criadas: (NovaAssinaturaNoGateway & { id: string })[];
  valoresAlterados: { id: string; valorCentavos: number }[];
  canceladas: string[];
  /** O que `consultar` devolve para essa assinatura. */
  definirAssinatura(assinatura: AssinaturaNoGateway): void;
  definirCobranca(cobranca: CobrancaNoGateway): void;
  /** A próxima chamada a `criar` falha. */
  falharNaProximaCriacao(): void;
};

export function criarGatewayAssinaturasFake(): GatewayAssinaturasFake {
  const assinaturas = new Map<string, AssinaturaNoGateway>();
  const cobrancas = new Map<string, CobrancaNoGateway>();
  let falhar = false;
  let proximo = 1;

  const fake: GatewayAssinaturasFake = {
    criadas: [],
    valoresAlterados: [],
    canceladas: [],
    definirAssinatura: (assinatura) => assinaturas.set(assinatura.id, assinatura),
    definirCobranca: (cobranca) => cobrancas.set(cobranca.id, cobranca),
    falharNaProximaCriacao: () => {
      falhar = true;
    },

    async criar(dados) {
      if (falhar) {
        falhar = false;
        throw new Error('Mercado Pago fora do ar');
      }
      const id = `pre-${proximo++}`;
      fake.criadas.push({ ...dados, id });
      assinaturas.set(id, { id, situacao: 'PENDENTE', referencia: dados.referencia });
      return { id, linkPagamento: `https://mp.test/assinar/${id}` };
    },
    async consultar(id) {
      const assinatura = assinaturas.get(id);
      if (!assinatura) {
        throw new Error(`assinatura ${id} não existe no fake`);
      }
      return assinatura;
    },
    async consultarCobranca(id) {
      const cobranca = cobrancas.get(id);
      if (!cobranca) {
        throw new Error(`cobrança ${id} não existe no fake`);
      }
      return cobranca;
    },
    async alterarValor(id, valorCentavos) {
      fake.valoresAlterados.push({ id, valorCentavos });
    },
    async cancelar(id) {
      fake.canceladas.push(id);
      const assinatura = assinaturas.get(id);
      if (assinatura) {
        assinaturas.set(id, { ...assinatura, situacao: 'CANCELADA' });
      }
    },
  };
  return fake;
}
