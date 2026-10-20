import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MenuRepository } from '../../menu/menu.repository.js';
import { calcularPrecoUnitario } from '../../menu/menu.service.js';
import { criarPedido } from '../../orders/orders.service.js';
import type { OrdersRepository } from '../../orders/orders.repository.js';
import { DomainError } from '../../shared/errors/domain-error.js';

const carrinhoInputSchema = z.object({
  empreendedorId: z.string().min(1),
  itens: z
    .array(
      z.object({
        itemCardapioId: z.string().min(1),
        quantidade: z.number().int().positive(),
        // Aceito por compatibilidade, mas ignorado: o preço é calculado aqui.
        precoUnitario: z.number().nonnegative().optional(),
        /** { nomeDaVariacao: nomeDaOpcao }, ex.: { "Tamanho": "G" } */
        variacaoEscolhida: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1),
});

export function registerOrdersRoutes(
  app: FastifyInstance,
  ordersRepo: OrdersRepository,
  menuRepo: MenuRepository,
  pedidoTtlMinutos: number,
): void {
  app.post('/orders', async (request, reply) => {
    const parseResult = carrinhoInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ erro: 'Carrinho inválido.', detalhes: parseResult.error.flatten() });
    }
    const carrinho = parseResult.data;

    const { itens: disponiveis } = await menuRepo.obterCardapioPublico(carrinho.empreendedorId);
    const porId = new Map(disponiveis.map((item) => [item.id, item]));

    let itens;
    try {
      itens = carrinho.itens.map((itemCarrinho) => {
        const item = porId.get(itemCarrinho.itemCardapioId);
        if (!item) {
          throw new DomainError('Um dos itens do carrinho não está mais disponível.', 'ITEM_INDISPONIVEL');
        }
        return {
          itemCardapioId: item.id,
          quantidade: itemCarrinho.quantidade,
          precoUnitario: calcularPrecoUnitario(item, itemCarrinho.variacaoEscolhida),
          variacaoEscolhida: itemCarrinho.variacaoEscolhida,
        };
      });
    } catch (erro) {
      if (erro instanceof DomainError) {
        return reply.status(400).send({ erro: erro.message });
      }
      throw erro;
    }

    const pedido = await criarPedido(ordersRepo, { empreendedorId: carrinho.empreendedorId, itens }, pedidoTtlMinutos);
    return reply.status(201).send({ pedido });
  });
}
