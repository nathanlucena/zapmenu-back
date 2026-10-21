import type { FastifyInstance } from 'fastify';
import type { PreviasRepository } from '../../menu/gestao/previa.js';
import { DomainError } from '../../shared/errors/domain-error.js';

/** Dados da prévia em imagem, para o front desenhar. Só dados do cardápio, nada de cliente. */
export function registerPreviasRoutes(app: FastifyInstance, previas: PreviasRepository): void {
  app.get('/previas/:id', async (request) => {
    const { id } = request.params as { id: string };
    const previa = await previas.buscar(id);
    if (!previa) {
      throw new DomainError('Esta prévia não existe ou já venceu.', 'PREVIA_NAO_ENCONTRADA', 'NAO_ENCONTRADO');
    }
    return { previa };
  });
}
