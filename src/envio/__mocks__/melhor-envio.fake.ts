import type { ServicoEnvio } from '../../orders/domain/pedido.js';
import type { Medidas } from '../domain/pacote.js';
import type { ContaDaLoja, ContasMelhorEnvioRepository } from '../application/ports/contas-melhor-envio.repository.js';
import type { EtiquetaParaComprar, GatewayMelhorEnvio, PontaDoEnvio, TokensMelhorEnvio } from '../application/ports/gateway-melhor-envio.js';

export const SERVICOS_FAKE: ServicoEnvio[] = [
  { id: '1', nome: 'PAC', empresa: 'Correios', preco: 22.5, prazoDias: 6 },
  { id: '2', nome: 'SEDEX', empresa: 'Correios', preco: 41.9, prazoDias: 2 },
];

/** Melhor Envio de mentira: tokens previsíveis, cotação fixa e falhas sob comando. */
export function criarGatewayMelhorEnvioFake() {
  const fake: GatewayMelhorEnvio & {
    cotacoes: Parameters<GatewayMelhorEnvio['cotar']>[1][];
    etiquetas: EtiquetaParaComprar[];
    renovacoes: number;
    falhasNaCotacao: number;
    servicos: ServicoEnvio[];
  } = {
    cotacoes: [],
    etiquetas: [],
    renovacoes: 0,
    falhasNaCotacao: 0,
    servicos: SERVICOS_FAKE,
    urlDeAutorizacao: (state) => `https://sandbox.melhorenvio.test/oauth/authorize?state=${encodeURIComponent(state)}`,
    async trocarCodigo(codigo) {
      return { accessToken: `access-${codigo}`, refreshToken: `refresh-${codigo}`, expiraEm: new Date(Date.now() + 30 * 24 * 3_600_000) };
    },
    async renovar(refreshToken) {
      fake.renovacoes++;
      return { accessToken: `access-renovado-${fake.renovacoes}`, refreshToken: `${refreshToken}+`, expiraEm: new Date(Date.now() + 30 * 24 * 3_600_000) };
    },
    async cotar(_token, pedido) {
      fake.cotacoes.push(pedido);
      if (fake.falhasNaCotacao > 0) {
        fake.falhasNaCotacao--;
        throw new Error('Melhor Envio fora do ar');
      }
      return fake.servicos;
    },
    async comprarEtiqueta(_token, etiqueta) {
      fake.etiquetas.push(etiqueta);
      return { etiquetaId: `etq-${fake.etiquetas.length}`, rastreio: `ME${fake.etiquetas.length}BR` };
    },
    async baixarEtiqueta() {
      return new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    },
  };
  return fake;
}

export function criarContasMelhorEnvioFake(loja: { lojaId: string; telefone: string; empreendedorId: string }, tokens?: TokensMelhorEnvio) {
  const conta: ContaDaLoja = { lojaId: loja.lojaId, telefone: loja.telefone, tokens };
  const medidas = new Map<string, { produto: Medidas; categoria: Medidas }>();
  let remetente: PontaDoEnvio | null = {
    nome: 'Alecrim Moda',
    telefone: loja.telefone,
    cep: '13015002',
    logradouro: 'Rua Barão de Jaguara',
    numero: '1200',
    cidade: 'Campinas',
    uf: 'SP',
  };
  const ehDaLoja = (id: string) => [loja.lojaId, loja.telefone, loja.empreendedorId].includes(id);
  const fake: ContasMelhorEnvioRepository & {
    conta: ContaDaLoja;
    definirMedidas(itemId: string, produto: Medidas, categoria?: Medidas): void;
    semRemetente(): void;
  } = {
    conta,
    definirMedidas: (itemId, produto, categoria = {}) => medidas.set(itemId, { produto, categoria }),
    semRemetente: () => {
      remetente = null;
    },
    async daLoja(identificador) {
      return ehDaLoja(identificador) ? { ...conta } : null;
    },
    async salvarTokens(_lojaId, novos) {
      conta.tokens = novos;
      conta.falhaDesde = undefined;
    },
    async registrarFalha(_lojaId, desde) {
      conta.falhaDesde = desde;
    },
    async registrarAvisoDeFalha(_lojaId, em) {
      conta.avisoFalhaEm = em;
    },
    async limparFalha() {
      conta.falhaDesde = undefined;
    },
    async medidasDosItens(itemIds) {
      return new Map(itemIds.flatMap((id) => (medidas.has(id) ? [[id, medidas.get(id)!] as const] : [])));
    },
    async remetente() {
      return remetente;
    },
  };
  return fake;
}
