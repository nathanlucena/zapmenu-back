import type { FastifyInstance } from 'fastify';
import { logger } from '../../shared/logger/logger.js';

export function registerRequestLogger(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    logger.info({ method: request.method, url: request.url }, 'requisição recebida');
  });
}
