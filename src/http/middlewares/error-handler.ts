import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { DomainError } from '../../shared/errors/domain-error.js';
import { logger } from '../../shared/logger/logger.js';

export function errorHandler(error: FastifyError, _request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof DomainError) {
    reply.status(400).send({ erro: error.message, codigo: error.code });
    return;
  }

  logger.error({ err: error }, 'Erro não tratado na API');
  reply.status(500).send({ erro: 'Erro interno.' });
}
