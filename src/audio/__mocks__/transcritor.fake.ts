import type { AudioParaTranscrever, Transcritor } from '../application/ports/transcritor.js';

/** Transcritor de mentira: devolve o texto combinado, demora ou falha quando o teste pede. */
export function criarTranscritorFake(texto = 'entrou pizza de calabresa 40 reais') {
  const recebidos: AudioParaTranscrever[] = [];
  const fake: Transcritor & { recebidos: AudioParaTranscrever[]; texto: string; falhar: boolean; nuncaResponder: boolean } = {
    recebidos,
    texto,
    falhar: false,
    nuncaResponder: false,
    async transcrever(audio) {
      recebidos.push(audio);
      if (fake.nuncaResponder) return new Promise<string>(() => undefined);
      if (fake.falhar) throw new Error('serviço fora do ar');
      return fake.texto;
    },
  };
  return fake;
}
