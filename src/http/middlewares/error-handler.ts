import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { DomainError, type TipoErroDominio } from '../../shared/errors/domain-error.js';
import { logger } from '../../shared/logger/logger.js';

const STATUS_POR_TIPO: Record<TipoErroDominio, number> = {
  REGRA_VIOLADA: 400,
  NAO_ENCONTRADO: 404,
  CONFLITO: 409,
};

export function errorHandler(error: FastifyError, _request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof DomainError) {
    reply.status(STATUS_POR_TIPO[error.tipo]).send({ erro: error.message, codigo: error.code });
    return;
  }

  logger.error({ err: error }, 'Erro não tratado na API');
  reply.status(500).send({ erro: 'Erro interno.' });
}
