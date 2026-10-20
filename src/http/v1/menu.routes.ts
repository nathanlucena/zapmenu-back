import type { FastifyInstance } from 'fastify';
import type { MenuRepository } from '../../menu/menu.repository.js';
import { lojaNaoEncontrada } from '../../menu/menu.service.js';

export function registerMenuRoutes(app: FastifyInstance, menuRepo: MenuRepository): void {
  app.get('/menu/:empreendedorId', async (request) => {
    const { empreendedorId } = request.params as { empreendedorId: string };
    const cardapio = await menuRepo.obterCardapioPublico(empreendedorId);
    if (!cardapio) {
      throw lojaNaoEncontrada();
    }
    return cardapio;
  });
}
