import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { consultarPedido } from '../../orders/application/consultar-pedido.js';
import { cotarEntrega } from '../../orders/application/cotar-entrega.js';
import { enderecoDeEnvio } from '../../orders/application/endereco-de-envio.js';
import { criarPedidoDoCarrinho, type CriarPedidoDoCarrinhoDeps } from '../../orders/application/criar-pedido.js';
import { DomainError } from '../../shared/errors/domain-error.js';
import { detalhesDaValidacao } from '../validacao/mensagens-zod.js';

const texto = (max: number) => z.string().trim().min(1).max(max);

const enderecoSchema = z.object({
  cep: texto(9).optional(),
  logradouro: texto(120).optional(),
  numero: texto(10).optional(),
  semNumero: z.boolean().optional(),
  complemento: texto(80).optional(),
  bairro: texto(80).optional(),
  cidade: texto(80).optional(),
  uf: z.string().trim().length(2).optional(),
});

const carrinhoInputSchema = z
  .object({
    empreendedorId: z.string().min(1),
    itens: z
      .array(
        z.object({
          itemCardapioId: z.string().min(1),
          /** Tamanho/cor escolhido; obrigatório para item com SKUs. */
          skuId: z.string().min(1).optional(),
          quantidade: z.number().int().positive(),
          // Aceito por compatibilidade, mas ignorado: o preço vem do cardápio.
          precoUnitario: z.number().nonnegative().optional(),
          /** { nomeDaVariacao: nomeDaOpcao }, ex.: { "Tamanho": "G" } */
          variacaoEscolhida: z.record(z.string(), z.unknown()).optional(),
          observacao: texto(140).optional(),
        }),
      )
      .min(1),
    // Padrão RETIRADA: o app antigo não manda a modalidade.
    // ENVIO (frete fixo por região) foi removido: ainda é aceito aqui para responder com um erro claro.
    modalidade: z.enum(['RETIRADA', 'ENTREGA', 'MELHOR_ENVIO', 'ENVIO']).default('RETIRADA'),
    /** Só no Melhor Envio: o serviço escolhido na cotação. */
    servicoEnvioId: z.string().min(1).optional(),
    endereco: enderecoSchema.optional(),
    nomeCliente: texto(80).optional(),
    observacao: texto(280).optional(),
    formaPagamento: z.enum(['PIX', 'DINHEIRO', 'CARTAO']).default('PIX'),
    /** Só no dinheiro: quanto o cliente vai entregar. */
    trocoPara: z.number().positive().optional(),
  })
  .refine((carrinho) => carrinho.modalidade === 'RETIRADA' || carrinho.endereco, {
    message: 'Informe o endereço de entrega.',
    path: ['endereco'],
  });

const cotacaoInputSchema = z.object({ empreendedorId: z.string().min(1), endereco: enderecoSchema });

/** Cotação do Melhor Envio: precisa dos itens (peso, medidas e valor). */
const freteInputSchema = z.object({
  empreendedorId: z.string().min(1),
  endereco: enderecoSchema,
  itens: z
    .array(
      z.object({
        itemCardapioId: z.string().min(1),
        skuId: z.string().min(1).optional(),
        quantidade: z.number().int().positive(),
        variacaoEscolhida: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1),
});

export function registerOrdersRoutes(app: FastifyInstance, deps: CriarPedidoDoCarrinhoDeps): void {
  app.post('/orders', async (request, reply) => {
    const parseResult = carrinhoInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply
        .status(400)
        .send({ erro: 'Carrinho inválido.', codigo: 'CARRINHO_INVALIDO', detalhes: detalhesDaValidacao(parseResult.error) });
    }

    const { itens, ...carrinho } = parseResult.data;
    const pedido = await criarPedidoDoCarrinho(deps, {
      ...carrinho,
      itens: itens.map(({ itemCardapioId, skuId, quantidade, variacaoEscolhida, observacao }) => ({
        itemCardapioId,
        skuId,
        quantidade,
        variacaoEscolhida,
        observacao,
      })),
    });
    return reply.status(201).send({ pedido });
  });

  /** Taxa de entrega para o app mostrar o total antes de criar o pedido. */
  app.post('/entrega/cotacao', async (request, reply) => {
    const parseResult = cotacaoInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply
        .status(400)
        .send({ erro: 'Endereço inválido.', codigo: 'ENDERECO_INVALIDO', detalhes: detalhesDaValidacao(parseResult.error) });
    }

    const { empreendedorId, endereco } = parseResult.data;
    const regras = await deps.lojaParaPedidos.regrasDe(empreendedorId);
    if (!regras) {
      throw new DomainError('Loja não encontrada.', 'LOJA_NAO_ENCONTRADA', 'NAO_ENCONTRADO');
    }
    const cotacao = await cotarEntrega(regras, deps.localizador, endereco);
    return {
      entrega: {
        enderecoFormatado: cotacao.endereco.enderecoFormatado,
        distanciaKm: cotacao.endereco.distanciaKm,
        taxa: cotacao.taxa,
        avisos: cotacao.avisos,
      },
    };
  });

  /**
   * Fretes do Melhor Envio para o CEP do cliente (PAC, SEDEX, transportadoras),
   * com preço e prazo. O pedido recalcula o escolhido: este valor é só para mostrar.
   */
  app.post('/frete/cotacao', async (request, reply) => {
    const parseResult = freteInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply
        .status(400)
        .send({ erro: 'Endereço inválido.', codigo: 'ENDERECO_INVALIDO', detalhes: detalhesDaValidacao(parseResult.error) });
    }

    const { empreendedorId, endereco, itens } = parseResult.data;
    const regras = await deps.lojaParaPedidos.regrasDe(empreendedorId);
    if (!regras) {
      throw new DomainError('Loja não encontrada.', 'LOJA_NAO_ENCONTRADA', 'NAO_ENCONTRADO');
    }
    if (!regras.melhorEnvio || !deps.cotadorDeFrete) {
      throw new DomainError('Esta loja não envia por transportadora.', 'ENVIO_INDISPONIVEL');
    }
    const precificados = await deps.cardapioDePrecos.precificar(empreendedorId, itens);
    const destino = await enderecoDeEnvio(deps.consultaCep, endereco);
    const servicos = await deps.cotadorDeFrete.cotar(empreendedorId, {
      cepOrigem: regras.melhorEnvio.cepOrigem,
      cepDestino: destino.cep!,
      itens: precificados.map((item) => ({ itemCardapioId: item.itemCardapioId, quantidade: item.quantidade, precoUnitario: item.precoUnitario })),
    });
    return { frete: { enderecoFormatado: destino.enderecoFormatado, servicos } };
  });

  app.get('/orders/:codigoCurto', async (request) => {
    const { codigoCurto } = request.params as { codigoCurto: string };
    return { pedido: await consultarPedido(deps.ordersRepo, codigoCurto) };
  });
}
