import { describe, expect, it, vi } from 'vitest';
import type { Pedido } from '../orders/domain/pedido.js';
import { criarContasMelhorEnvioFake, criarGatewayMelhorEnvioFake, SERVICOS_FAKE } from './__mocks__/melhor-envio.fake.js';
import { assinarEstado, concluirConexao, contaConectada, lerEstado, linkParaConectar, tokenValido } from './application/conexao.js';
import { criarCotadorMelhorEnvio, FRETE_INDISPONIVEL } from './application/cotador.js';
import type { MelhorEnvioDeps } from './application/dependencias.js';
import { gerarEtiqueta } from './application/etiqueta.js';
import { MEDIDAS_PADRAO, medidasDoProduto } from './domain/pacote.js';
import { criarMelhorEnvioClient } from './infra/melhor-envio.client.js';

const LOJA = { lojaId: 'loja-1', telefone: '5519999990000', empreendedorId: 'emp-1' };
const SEGREDO = 'segredo-do-app';
const AGORA = new Date('2026-10-28T15:00:00Z');
const UM_MES = 30 * 24 * 3_600_000;

function cenario(conectada = true, agora = AGORA) {
  const gateway = criarGatewayMelhorEnvioFake();
  const contas = criarContasMelhorEnvioFake(
    LOJA,
    conectada ? { accessToken: 'access-1', refreshToken: 'refresh-1', expiraEm: new Date(agora.getTime() + UM_MES) } : undefined,
  );
  const avisos: string[] = [];
  let relogio = agora;
  const deps: MelhorEnvioDeps = {
    gateway,
    contas,
    mensageiro: { enviarTexto: async (_telefone, texto) => void avisos.push(texto) },
    segredo: SEGREDO,
    relogio: () => relogio,
  };
  return { deps, gateway, contas, avisos, avancar: (ms: number) => (relogio = new Date(relogio.getTime() + ms)) };
}

const PEDIDO_COTACAO = { cepOrigem: '13015002', cepDestino: '50050000', itens: [{ itemCardapioId: 'camiseta', quantidade: 2, precoUnitario: 59.9 }] };

describe('medidas do pacote', () => {
  it('produto, depois categoria, depois o padrão, campo a campo', () => {
    expect(medidasDoProduto({ pesoGramas: 200 }, { pesoGramas: 500, alturaCm: 6 })).toEqual({
      pesoGramas: 200,
      alturaCm: 6,
      larguraCm: MEDIDAS_PADRAO.larguraCm,
      comprimentoCm: MEDIDAS_PADRAO.comprimentoCm,
    });
    expect(medidasDoProduto({})).toEqual(MEDIDAS_PADRAO);
  });
});

describe('conexão por OAuth', () => {
  it('o link leva o state assinado da loja; o retorno guarda os tokens e avisa na gestão', async () => {
    const { deps, contas, avisos } = cenario(false);
    const link = await linkParaConectar(deps, LOJA.telefone);
    const state = decodeURIComponent(new URL(link!).searchParams.get('state')!);
    expect(lerEstado(state, SEGREDO, AGORA)).toBe('loja-1');
    expect(await contaConectada(deps, LOJA.telefone)).toBe(false);

    await concluirConexao(deps, state, 'codigo-1');

    expect(contas.conta.tokens).toMatchObject({ accessToken: 'access-codigo-1', refreshToken: 'refresh-codigo-1' });
    expect(await contaConectada(deps, LOJA.telefone)).toBe(true);
    expect(avisos[0]).toContain('conta do Melhor Envio está conectada');
  });

  it('recusa state adulterado, de outro segredo ou vencido', async () => {
    const { deps } = cenario(false);
    const valido = assinarEstado('loja-1', SEGREDO, AGORA);
    expect(lerEstado(valido.replace('loja-1', 'loja-2'), SEGREDO, AGORA)).toBeUndefined();
    expect(lerEstado(assinarEstado('loja-1', 'outro', AGORA), SEGREDO, AGORA)).toBeUndefined();
    expect(lerEstado(valido, SEGREDO, new Date(AGORA.getTime() + 25 * 3_600_000))).toBeUndefined();
    await expect(concluirConexao(deps, 'lixo', 'codigo')).rejects.toMatchObject({ code: 'CONEXAO_INVALIDA' });
  });

  it('renova o token quando falta pouco para vencer, e guarda o novo', async () => {
    const { deps, gateway, contas } = cenario();
    contas.conta.tokens!.expiraEm = new Date(AGORA.getTime() + 60_000);
    expect((await tokenValido(deps, LOJA.empreendedorId))?.accessToken).toBe('access-renovado-1');
    expect(gateway.renovacoes).toBe(1);
    expect(contas.conta.tokens?.refreshToken).toBe('refresh-1+');
  });
});

describe('cotação no checkout', () => {
  it('manda as medidas de cada produto (ou da categoria) com o valor declarado', async () => {
    const { deps, gateway, contas } = cenario();
    contas.definirMedidas('camiseta', { pesoGramas: 250 }, { alturaCm: 3, larguraCm: 25, comprimentoCm: 30 });

    expect(await criarCotadorMelhorEnvio(deps).cotar(LOJA.empreendedorId, PEDIDO_COTACAO)).toEqual(SERVICOS_FAKE);
    expect(gateway.cotacoes[0]).toEqual({
      cepOrigem: '13015002',
      cepDestino: '50050000',
      produtos: [{ id: 'camiseta', pesoKg: 0.25, alturaCm: 3, larguraCm: 25, comprimentoCm: 30, valor: 59.9, quantidade: 2 }],
    });
  });

  it('tenta de novo uma vez antes de desistir', async () => {
    const { deps, gateway } = cenario();
    gateway.falhasNaCotacao = 1;
    expect(await criarCotadorMelhorEnvio(deps).cotar(LOJA.empreendedorId, PEDIDO_COTACAO)).toEqual(SERVICOS_FAKE);
    expect(gateway.cotacoes).toHaveLength(2);
  });

  it('falhou duas vezes: FRETE_INDISPONIVEL; passando de 30 min, avisa o lojista uma vez; quando volta, limpa', async () => {
    const { deps, gateway, contas, avisos, avancar } = cenario();
    const cotador = criarCotadorMelhorEnvio(deps);
    gateway.falhasNaCotacao = 99;

    await expect(cotador.cotar(LOJA.empreendedorId, PEDIDO_COTACAO)).rejects.toMatchObject({ code: 'FRETE_INDISPONIVEL', message: FRETE_INDISPONIVEL });
    expect(contas.conta.falhaDesde).toEqual(AGORA);
    expect(avisos).toEqual([]);

    avancar(31 * 60_000);
    await expect(cotador.cotar(LOJA.empreendedorId, PEDIDO_COTACAO)).rejects.toMatchObject({ code: 'FRETE_INDISPONIVEL' });
    avancar(5 * 60_000);
    await expect(cotador.cotar(LOJA.empreendedorId, PEDIDO_COTACAO)).rejects.toMatchObject({ code: 'FRETE_INDISPONIVEL' });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('sem responder há mais de 30 minutos');

    gateway.falhasNaCotacao = 0;
    await cotador.cotar(LOJA.empreendedorId, PEDIDO_COTACAO);
    expect(contas.conta.falhaDesde).toBeUndefined();
  });

  it('sem a conta conectada, a loja não envia por transportadora', async () => {
    const { deps } = cenario(false);
    await expect(criarCotadorMelhorEnvio(deps).cotar(LOJA.empreendedorId, PEDIDO_COTACAO)).rejects.toMatchObject({ code: 'ENVIO_INDISPONIVEL' });
  });
});

describe('etiqueta', () => {
  const pedido = (dados: Partial<Pedido> = {}): Pedido => ({
    id: 'p1',
    codigoCurto: 'PED-AB23',
    empreendedorId: LOJA.empreendedorId,
    status: 'PAGO',
    modalidade: 'MELHOR_ENVIO',
    nomeCliente: 'Maria',
    telefoneCliente: '5581988887777',
    valorTotal: 141.7,
    taxaEntrega: 22.5,
    servicoEnvio: SERVICOS_FAKE[0],
    entrega: { cep: '50050000', logradouro: 'Rua da Aurora', numero: '123', bairro: 'Boa Vista', cidade: 'Recife', uf: 'PE', enderecoFormatado: 'Rua da Aurora, 123' },
    itens: [{ itemCardapioId: 'camiseta', quantidade: 2, precoUnitario: 59.6 }],
    expiraEm: AGORA,
    criadoEm: AGORA,
    ...dados,
  });

  it('compra com o saldo do lojista e devolve o PDF e o rastreio', async () => {
    const { deps, gateway } = cenario();
    const etiqueta = await gerarEtiqueta(deps, pedido());
    expect(etiqueta).toMatchObject({ etiquetaId: 'etq-1', rastreio: 'ME1BR', transportadora: 'Correios' });
    expect(etiqueta.pdf.length).toBeGreaterThan(0);
    expect(gateway.etiquetas[0]).toMatchObject({
      servicoId: '1',
      referencia: 'PED-AB23',
      de: { nome: 'Alecrim Moda', cep: '13015002' },
      para: { nome: 'Maria', cep: '50050000', numero: '123', cidade: 'Recife' },
    });
  });

  it('só para pedido pago, por Melhor Envio e ainda sem etiqueta', async () => {
    const { deps } = cenario();
    await expect(gerarEtiqueta(deps, pedido({ status: 'AGUARDANDO_PAGAMENTO' }))).rejects.toMatchObject({ code: 'ETIQUETA_INDISPONIVEL' });
    await expect(gerarEtiqueta(deps, pedido({ modalidade: 'ENTREGA' }))).rejects.toMatchObject({ code: 'ETIQUETA_INDISPONIVEL' });
    await expect(gerarEtiqueta(deps, pedido({ etiquetaId: 'etq-0' }))).rejects.toMatchObject({ code: 'ETIQUETA_REPETIDA' });
  });
});

describe('cliente HTTP (sandbox)', () => {
  function cliente(respostas: unknown[]) {
    const fetchMock = vi.fn();
    for (const resposta of respostas) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(resposta), { status: 200 }));
    }
    return {
      fetchMock,
      gateway: criarMelhorEnvioClient(
        { clientId: 'cid', clientSecret: 'csecret', urlDeRetorno: 'https://zap.test/api/melhor-envio/retorno', sandbox: true, emailDeContato: 'dev@zap.test' },
        fetchMock as unknown as typeof fetch,
      ),
    };
  }

  it('o link de autorização é do sandbox, com o state e a URL de retorno', () => {
    const url = new URL(cliente([]).gateway.urlDeAutorizacao('abc.1.xyz'));
    expect(url.origin).toBe('https://sandbox.melhorenvio.com.br');
    expect(url.searchParams.get('state')).toBe('abc.1.xyz');
    expect(url.searchParams.get('redirect_uri')).toBe('https://zap.test/api/melhor-envio/retorno');
  });

  it('cotação: tira os serviços com erro, usa o preço com desconto e ordena pelo mais barato', async () => {
    const { gateway, fetchMock } = cliente([
      [
        { id: 2, name: 'SEDEX', price: '45.00', custom_price: '41.90', custom_delivery_time: 2, company: { name: 'Correios' } },
        { id: 1, name: 'PAC', price: '22.50', delivery_time: 6, company: { name: 'Correios' } },
        { id: 3, name: 'Expresso', error: 'Transportadora não atende este trecho.', company: { name: 'Jadlog' } },
      ],
    ]);
    const servicos = await gateway.cotar('tok', { cepOrigem: '13015002', cepDestino: '50050000', produtos: [] });
    expect(servicos).toEqual([
      { id: '1', nome: 'PAC', empresa: 'Correios', preco: 22.5, prazoDias: 6 },
      { id: '2', nome: 'SEDEX', empresa: 'Correios', preco: 41.9, prazoDias: 2 },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', 'User-Agent': 'ZapMenu (dev@zap.test)' });
  });

  it('etiqueta: carrinho, pagamento, geração e rastreio, nessa ordem', async () => {
    const { gateway, fetchMock } = cliente([{ id: 'ord-9' }, {}, {}, { 'ord-9': { tracking: 'BR123' } }]);
    const comprada = await gateway.comprarEtiqueta('tok', {
      servicoId: '1',
      referencia: 'PED-AB23',
      de: { nome: 'Loja', cep: '13015002', logradouro: 'Rua A', numero: '1' },
      para: { nome: 'Maria', cep: '50050000', logradouro: 'Rua B', numero: '2' },
      produtos: [{ id: 'camiseta', pesoKg: 0.3, alturaCm: 4, larguraCm: 20, comprimentoCm: 30, valor: 59.9, quantidade: 2 }],
    });
    expect(comprada).toEqual({ etiquetaId: 'ord-9', rastreio: 'BR123' });
    expect(fetchMock.mock.calls.map(([url]) => new URL(url as string).pathname)).toEqual([
      '/api/v2/me/cart',
      '/api/v2/me/shipment/checkout',
      '/api/v2/me/shipment/generate',
      '/api/v2/me/shipment/tracking',
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ service: 1, volumes: [{ height: 8, weight: 0.6 }] });
  });
});
