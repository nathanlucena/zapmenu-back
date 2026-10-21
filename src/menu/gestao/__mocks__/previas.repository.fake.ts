import type { Previa, PreviasRepository } from '../previa.js';

export function criarPreviasRepositoryFake(): PreviasRepository & { guardadas: Map<string, Previa> } {
  const guardadas = new Map<string, Previa>();
  const vencem = new Map<string, number>();
  let proximo = 1;
  return {
    guardadas,
    async guardar(previa, validadeMs) {
      const id = `previa-${proximo++}`;
      guardadas.set(id, structuredClone(previa));
      vencem.set(id, Date.now() + validadeMs);
      return id;
    },
    async buscar(id, agora = new Date()) {
      const previa = guardadas.get(id);
      return previa && (vencem.get(id) ?? 0) > agora.getTime() ? previa : null;
    },
    async apagarVencidas(agora = new Date()) {
      let apagadas = 0;
      for (const [id, vence] of vencem) {
        if (vence <= agora.getTime()) {
          guardadas.delete(id);
          vencem.delete(id);
          apagadas++;
        }
      }
      return apagadas;
    },
  };
}
