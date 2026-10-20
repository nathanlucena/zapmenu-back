import type { DadosLoja, FaixaEntrega } from './conversation/conversation-state.types.js';

export const MAX_FAIXAS_ENTREGA = 6;
export const RAIO_MAXIMO_KM = 30;
const RAIO_TERRA_KM = 6371;

export interface Coordenada {
  latitude: number;
  longitude: number;
}

/** Distância em linha reta (Haversine), em km. */
export function distanciaKm(origem: Coordenada, destino: Coordenada): number {
  const rad = (graus: number) => (graus * Math.PI) / 180;
  const dLat = rad(destino.latitude - origem.latitude);
  const dLon = rad(destino.longitude - origem.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(origem.latitude)) * Math.cos(rad(destino.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * RAIO_TERRA_KM * Math.asin(Math.sqrt(a));
}

export type ResultadoEntrega =
  | { disponivel: true; distanciaKm: number; taxa: number }
  | { disponivel: false; distanciaKm: number; motivo: 'FORA_DA_AREA' }
  | { disponivel: false; motivo: 'LOJA_SEM_ENTREGA' | 'LOJA_SEM_ENDERECO' | 'SEM_FAIXAS' };

/**
 * Taxa de entrega até `destino`. O limite de cada faixa é inclusivo ("até 1 km"
 * vale para 1,000 km). Loja com a taxa fixa antiga e sem faixas não entrega.
 */
export function calcularEntrega(
  loja: Pick<DadosLoja, 'fazEntrega' | 'enderecoVerificado' | 'faixasEntrega'>,
  destino: Coordenada,
): ResultadoEntrega {
  if (!loja.fazEntrega) {
    return { disponivel: false, motivo: 'LOJA_SEM_ENTREGA' };
  }
  if (!loja.enderecoVerificado) {
    return { disponivel: false, motivo: 'LOJA_SEM_ENDERECO' };
  }
  const faixas = [...(loja.faixasEntrega ?? [])].sort((a, b) => a.ateKm - b.ateKm);
  if (faixas.length === 0) {
    return { disponivel: false, motivo: 'SEM_FAIXAS' };
  }

  const distancia = distanciaKm(loja.enderecoVerificado, destino);
  const faixa = faixas.find((candidata) => distancia <= candidata.ateKm);
  if (!faixa) {
    return { disponivel: false, distanciaKm: distancia, motivo: 'FORA_DA_AREA' };
  }
  return { disponivel: true, distanciaKm: distancia, taxa: faixa.taxa };
}

/** A loja só entrega de verdade com endereço verificado e ao menos uma faixa. */
export function entregaConfigurada(loja: Pick<DadosLoja, 'enderecoVerificado' | 'faixasEntrega'>): boolean {
  return Boolean(loja.enderecoVerificado) && (loja.faixasEntrega?.length ?? 0) > 0;
}

export function raioMaximoKm(faixas: FaixaEntrega[] = []): number | undefined {
  return faixas.length > 0 ? Math.max(...faixas.map((faixa) => faixa.ateKm)) : undefined;
}

/**
 * Valida a lista completa de faixas. Faixas inválidas são descartadas com um
 * aviso; a ordem é corrigida sem aviso. `faixas` vem undefined se nada sobrou.
 */
export function validarFaixas(entrada: FaixaEntrega[]): { faixas?: FaixaEntrega[]; avisos: string[] } {
  const avisos: string[] = [];
  const validas: FaixaEntrega[] = [];

  for (const faixa of entrada) {
    if (!Number.isFinite(faixa.ateKm) || faixa.ateKm <= 0) {
      avisos.push('⚠️ Não consegui aplicar uma faixa de entrega com distância inválida.');
    } else if (faixa.ateKm > RAIO_MAXIMO_KM) {
      avisos.push(
        `⚠️ Não consegui aplicar: raio de ${formatarKm(faixa.ateKm)} é maior que o limite de ${RAIO_MAXIMO_KM} km.`,
      );
    } else if (!Number.isFinite(faixa.taxa) || faixa.taxa < 0) {
      avisos.push(`⚠️ Não consegui aplicar a faixa de até ${formatarKm(faixa.ateKm)}: a taxa não pode ser negativa.`);
    } else if (validas.some((existente) => existente.ateKm === faixa.ateKm)) {
      avisos.push(`⚠️ A faixa de até ${formatarKm(faixa.ateKm)} apareceu duas vezes; fiquei com a primeira.`);
    } else {
      validas.push({ ateKm: Math.round(faixa.ateKm * 100) / 100, taxa: Math.round(faixa.taxa * 100) / 100 });
    }
  }

  if (validas.length > MAX_FAIXAS_ENTREGA) {
    avisos.push(`⚠️ Dá para ter no máximo ${MAX_FAIXAS_ENTREGA} faixas de entrega. Pode juntar algumas?`);
    return { avisos };
  }
  if (validas.length === 0) {
    return { avisos };
  }
  return { faixas: validas.sort((a, b) => a.ateKm - b.ateKm), avisos };
}

/** Pares em que uma faixa mais distante é mais barata que a anterior (só alerta, não bloqueia). */
export function faixasComTaxaDecrescente(faixas: FaixaEntrega[]): [FaixaEntrega, FaixaEntrega][] {
  const pares: [FaixaEntrega, FaixaEntrega][] = [];
  for (let i = 1; i < faixas.length; i++) {
    if (faixas[i]!.taxa < faixas[i - 1]!.taxa) {
      pares.push([faixas[i - 1]!, faixas[i]!]);
    }
  }
  return pares;
}

/** "1 km", "0,5 km", "2,5 km". */
export function formatarKm(km: number): string {
  return `${String(Math.round(km * 100) / 100).replace('.', ',')} km`;
}
