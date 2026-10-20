import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { consultarPedido } from '../../orders/application/consultar-pedido.js';
import { cotarEntrega } from '../../orders/application/cotar-entrega.js';
import { criarPedidoDoCarrinho, type CriarPedidoDoCarrinhoDeps } from '../../orders/application/criar-pedido.js';
import { DomainError } from '../../shared/errors/domain-error.js';

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
          quantidade: z.number().int().positive(),
          // Aceito por compatibilidade, mas ignorado: o preço vem do cardápio.
          precoUnitario: z.number().nonnegative().optional(),
          /** { nomeDaVariacao: nomeDaOpcao }, ex.: { "Tamanho": "G" } */
          variacaoEscolhida: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .min(1),
    // Padrão RETIRADA: o app antigo não manda a modalidade.
    modalidade: z.enum(['RETIRADA', 'ENTREGA']).default('RETIRADA'),
    endereco: enderecoSchema.optional(),
    nomeCliente: texto(80).optional(),
    observacao: texto(280).optional(),
  })
  .refine((carrinho) => carrinho.modalidade === 'RETIRADA' || carrinho.endereco, {
    message: 'Informe o endereço de entrega.',
    path: ['endereco'],
  });

const cotacaoInputSchema = z.object({ empreendedorId: z.string().min(1), endereco: enderecoSchema });

export function registerOrdersRoutes(app: FastifyInstance, deps: CriarPedidoDoCarrinhoDeps): void {
  app.post('/orders', async (request, reply) => {
    const parseResult = carrinhoInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply
        .status(400)
        .send({ erro: 'Carrinho inválido.', codigo: 'CARRINHO_INVALIDO', detalhes: parseResult.error.flatten() });
    }

    const { itens, ...carrinho } = parseResult.data;
    const pedido = await criarPedidoDoCarrinho(deps, {
      ...carrinho,
      itens: itens.map(({ itemCardapioId, quantidade, variacaoEscolhida }) => ({
        itemCardapioId,
        quantidade,
        variacaoEscolhida,
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
        .send({ erro: 'Endereço inválido.', codigo: 'ENDERECO_INVALIDO', detalhes: parseResult.error.flatten() });
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

  app.get('/orders/:codigoCurto', async (request) => {
    const { codigoCurto } = request.params as { codigoCurto: string };
    return { pedido: await consultarPedido(deps.ordersRepo, codigoCurto) };
  });
}
