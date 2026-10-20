import type { FastifyInstance } from 'fastify';
import type { MenuRepository } from '../../menu/menu.repository.js';

export function registerMenuRoutes(app: FastifyInstance, menuRepo: MenuRepository): void {
  app.get('/menu/:empreendedorId', async (request) => {
    const { empreendedorId } = request.params as { empreendedorId: string };
    return menuRepo.obterCardapioPublico(empreendedorId);
  });
}
