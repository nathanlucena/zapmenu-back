import type { ServicoEnvio } from '../../orders/domain/pedido.js';
import { chamarServico, falhaHttp } from '../../shared/errors/integracao-error.js';
import type { ProdutoDoPacote } from '../domain/pacote.js';
import type { EtiquetaParaComprar, GatewayMelhorEnvio, PontaDoEnvio, TokensMelhorEnvio } from '../application/ports/gateway-melhor-envio.js';

export interface OpcoesMelhorEnvio {
  clientId: string;
  clientSecret: string;
  /** Para onde o Melhor Envio volta depois da autorização (rota /v1/melhor-envio/retorno). */
  urlDeRetorno: string;
  /** true = sandbox.melhorenvio.com.br (padrão). */
  sandbox: boolean;
  /** O Melhor Envio pede um contato no User-Agent. */
  emailDeContato: string;
}

/** Permissões pedidas na autorização: cotar, comprar, gerar, imprimir e rastrear etiquetas. */
const ESCOPOS = [
  'cart-read',
  'cart-write',
  'companies-read',
  'orders-read',
  'shipping-calculate',
  'shipping-checkout',
  'shipping-companies',
  'shipping-generate',
  'shipping-print',
  'shipping-tracking',
  'users-read',
].join(' ');

const TIMEOUT_MS = 15_000;

interface TokenMe {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface ServicoMe {
  id: number | string;
  name: string;
  price?: string | number;
  custom_price?: string | number;
  delivery_time?: number;
  custom_delivery_time?: number;
  company?: { name?: string };
  error?: string;
}

function paraTokens(resposta: TokenMe): TokensMelhorEnvio {
  return {
    accessToken: resposta.access_token,
    refreshToken: resposta.refresh_token,
    expiraEm: new Date(Date.now() + resposta.expires_in * 1000),
  };
}

function produtosDaCotacao(produtos: ProdutoDoPacote[]) {
  return produtos.map((produto) => ({
    id: produto.id,
    width: produto.larguraCm,
    height: produto.alturaCm,
    length: produto.comprimentoCm,
    weight: produto.pesoKg,
    insurance_value: produto.valor,
    quantity: produto.quantidade,
  }));
}

/** Um volume só: as peças empilhadas (altura somada), na maior largura e comprimento. */
function volumeUnico(produtos: ProdutoDoPacote[]) {
  return {
    height: produtos.reduce((soma, produto) => soma + produto.alturaCm * produto.quantidade, 0),
    width: Math.max(...produtos.map((produto) => produto.larguraCm)),
    length: Math.max(...produtos.map((produto) => produto.comprimentoCm)),
    weight: Math.round(produtos.reduce((soma, produto) => soma + produto.pesoKg * produto.quantidade, 0) * 1000) / 1000,
  };
}

function ponta(dados: PontaDoEnvio) {
  return {
    name: dados.nome,
    phone: dados.telefone,
    email: dados.email,
    document: dados.documento,
    address: dados.logradouro,
    number: dados.numero,
    complement: dados.complemento,
    district: dados.bairro,
    city: dados.cidade,
    state_abbr: dados.uf,
    postal_code: dados.cep,
  };
}

export function criarMelhorEnvioClient(opcoes: OpcoesMelhorEnvio, fetchFn: typeof fetch = fetch): GatewayMelhorEnvio {
  const base = opcoes.sandbox ? 'https://sandbox.melhorenvio.com.br' : 'https://melhorenvio.com.br';
  const cabecalhos = (accessToken?: string) => ({
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': `ZapMenu (${opcoes.emailDeContato})`,
    ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
  });

  async function chamar<T>(caminho: string, descricao: string, init: { metodo?: string; corpo?: unknown; accessToken?: string }): Promise<T> {
    const resposta = await chamarServico('melhor_envio', descricao, () =>
      fetchFn(`${base}${caminho}`, {
        method: init.metodo ?? 'POST',
        headers: cabecalhos(init.accessToken),
        body: init.corpo === undefined ? undefined : JSON.stringify(init.corpo),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
    );
    if (!resposta.ok) {
      throw falhaHttp('melhor_envio', resposta.status, descricao);
    }
    return (await resposta.json()) as T;
  }

  const token = (corpo: Record<string, string>) =>
    chamar<TokenMe>('/oauth/token', 'Falha ao autenticar no Melhor Envio', {
      corpo: { client_id: opcoes.clientId, client_secret: opcoes.clientSecret, ...corpo },
    }).then(paraTokens);

  return {
    urlDeAutorizacao(state) {
      const busca = new URLSearchParams({
        client_id: opcoes.clientId,
        redirect_uri: opcoes.urlDeRetorno,
        response_type: 'code',
        scope: ESCOPOS,
        state,
      });
      return `${base}/oauth/authorize?${busca.toString()}`;
    },

    trocarCodigo: (codigo) => token({ grant_type: 'authorization_code', redirect_uri: opcoes.urlDeRetorno, code: codigo }),

    renovar: (refreshToken) => token({ grant_type: 'refresh_token', refresh_token: refreshToken }),

    async cotar(accessToken, pedido) {
      const servicos = await chamar<ServicoMe[]>('/api/v2/me/shipment/calculate', 'Falha ao cotar o frete no Melhor Envio', {
        accessToken,
        corpo: {
          from: { postal_code: pedido.cepOrigem },
          to: { postal_code: pedido.cepDestino },
          products: produtosDaCotacao(pedido.produtos),
          options: { receipt: false, own_hand: false },
        },
      });
      // Serviço com "error" não atende esse CEP ou esse pacote.
      return servicos
        .filter((servico) => !servico.error && (servico.custom_price ?? servico.price) !== undefined)
        .map(
          (servico): ServicoEnvio => ({
            id: String(servico.id),
            nome: servico.name,
            empresa: servico.company?.name ?? '',
            preco: Number(servico.custom_price ?? servico.price),
            prazoDias: servico.custom_delivery_time ?? servico.delivery_time,
          }),
        )
        .sort((a, b) => a.preco - b.preco);
    },

    async comprarEtiqueta(accessToken, etiqueta: EtiquetaParaComprar) {
      const seguro = etiqueta.produtos.reduce((soma, produto) => soma + produto.valor * produto.quantidade, 0);
      const carrinho = await chamar<{ id: string }>('/api/v2/me/cart', 'Falha ao montar a etiqueta no Melhor Envio', {
        accessToken,
        corpo: {
          service: Number(etiqueta.servicoId),
          from: ponta(etiqueta.de),
          to: ponta(etiqueta.para),
          products: etiqueta.produtos.map((produto) => ({ name: produto.id, quantity: produto.quantidade, unitary_value: produto.valor })),
          volumes: [volumeUnico(etiqueta.produtos)],
          options: {
            insurance_value: Math.round(seguro * 100) / 100,
            receipt: false,
            own_hand: false,
            reverse: false,
            non_commercial: true,
            tags: [{ tag: etiqueta.referencia }],
          },
        },
      });
      const pedido = { orders: [carrinho.id] };
      // Paga com o saldo da conta do lojista e gera a etiqueta.
      await chamar('/api/v2/me/shipment/checkout', 'Falha ao pagar a etiqueta no Melhor Envio (confira o saldo)', { accessToken, corpo: pedido });
      await chamar('/api/v2/me/shipment/generate', 'Falha ao gerar a etiqueta no Melhor Envio', { accessToken, corpo: pedido });
      const rastreio = await chamar<Record<string, { tracking?: string | null; melhorenvio_tracking?: string | null }>>(
        '/api/v2/me/shipment/tracking',
        'Falha ao consultar o rastreio no Melhor Envio',
        { accessToken, corpo: pedido },
      ).catch(() => ({}) as Record<string, { tracking?: string | null; melhorenvio_tracking?: string | null }>);
      const doPedido = rastreio[carrinho.id];
      return { etiquetaId: carrinho.id, rastreio: doPedido?.tracking ?? doPedido?.melhorenvio_tracking ?? undefined };
    },

    async baixarEtiqueta(accessToken, etiquetaId) {
      const { url } = await chamar<{ url: string }>('/api/v2/me/shipment/print', 'Falha ao imprimir a etiqueta no Melhor Envio', {
        accessToken,
        corpo: { mode: 'public', orders: [etiquetaId] },
      });
      const pdf = await chamarServico('melhor_envio', 'Falha ao baixar a etiqueta', () =>
        fetchFn(url, { headers: { 'User-Agent': `ZapMenu (${opcoes.emailDeContato})` }, signal: AbortSignal.timeout(TIMEOUT_MS) }),
      );
      if (!pdf.ok) {
        throw falhaHttp('melhor_envio', pdf.status, 'Falha ao baixar a etiqueta');
      }
      return new Uint8Array(await pdf.arrayBuffer());
    },
  };
}
