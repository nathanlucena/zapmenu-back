import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { criarPedidoDoCarrinho, type CriarPedidoDoCarrinhoDeps } from '../../orders/application/criar-pedido.js';

const carrinhoInputSchema = z.object({
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
});

export function registerOrdersRoutes(app: FastifyInstance, deps: CriarPedidoDoCarrinhoDeps): void {
  app.post('/orders', async (request, reply) => {
    const parseResult = carrinhoInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply
        .status(400)
        .send({ erro: 'Carrinho inválido.', codigo: 'CARRINHO_INVALIDO', detalhes: parseResult.error.flatten() });
    }

    const { empreendedorId, itens } = parseResult.data;
    const pedido = await criarPedidoDoCarrinho(deps, {
      empreendedorId,
      itens: itens.map(({ itemCardapioId, quantidade, variacaoEscolhida }) => ({
        itemCardapioId,
        quantidade,
        variacaoEscolhida,
      })),
    });
    return reply.status(201).send({ pedido });
  });
}
