import type { IdempotencyRepository } from '../idempotency.repository.js';

export function criarIdempotencyRepositoryFake(): IdempotencyRepository {
  const processados = new Set<string>();

  return {
    async jaProcessado(origem, chaveExterna) {
      return processados.has(`${origem}:${chaveExterna}`);
    },
    async marcarProcessado(origem, chaveExterna) {
      processados.add(`${origem}:${chaveExterna}`);
    },
  };
}
