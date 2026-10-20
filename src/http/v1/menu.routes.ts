import type { FastifyInstance } from 'fastify';
import type { MenuRepository } from '../../menu/menu.repository.js';
import { lojaNaoEncontrada } from '../../menu/menu.service.js';

/** `whatsappPedidos`: número da sessão de pedidos, para o app montar o link wa.me. */
export function registerMenuRoutes(app: FastifyInstance, menuRepo: MenuRepository, whatsappPedidos?: string): void {
  // Aceita o link curto da loja ou o telefone do empreendedor.
  app.get('/menu/:identificador', async (request) => {
    const { identificador } = request.params as { identificador: string };
    const cardapio = await menuRepo.obterCardapioPublico(identificador);
    if (!cardapio) {
      throw lojaNaoEncontrada();
    }
    return { ...cardapio, whatsappPedidos };
  });
}
