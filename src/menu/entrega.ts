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

export type ModoEntrega = 'FIXA' | 'DISTANCIA';

/** O que a loja configurou de entrega (salvo, ou salvo + rascunho). */
export type ConfigEntrega = Pick<DadosLoja, 'fazEntrega' | 'faixasEntrega' | 'taxaEntrega' | 'raioEntregaKm' | 'modoEntrega'> & {
  enderecoVerificado?: Coordenada;
};

/** A entrega que vale agora: taxa fixa (com raio opcional) ou por faixas de distância. */
export type EntregaEmUso = { tipo: 'FIXA'; taxa: number; raioKm?: number } | { tipo: 'DISTANCIA'; faixas: FaixaEntrega[] };

/**
 * Como a loja entrega de fato. Por distância só com o recurso no plano, o
 * endereço verificado e ao menos uma faixa; sem o recurso (ou escolhendo),
 * vale a taxa fixa. Sem taxa fixa informada, não entrega (só retirada): nada
 * do que estava configurado é apagado. `fazEntrega` desligado não entrega.
 */
export function entregaEmUso(loja: ConfigEntrega, distanciaLiberada = true): EntregaEmUso | undefined {
  if (!loja.fazEntrega) {
    return undefined;
  }
  if ((loja.modoEntrega ?? 'DISTANCIA') === 'DISTANCIA' && distanciaLiberada) {
    const faixas = loja.faixasEntrega ?? [];
    return loja.enderecoVerificado && faixas.length > 0 ? { tipo: 'DISTANCIA', faixas } : undefined;
  }
  if (loja.taxaEntrega === undefined) {
    return undefined;
  }
  return { tipo: 'FIXA', taxa: loja.taxaEntrega, ...(loja.raioEntregaKm !== undefined && { raioKm: loja.raioEntregaKm }) };
}

/**
 * Taxa de entrega até `destino`. O limite de cada faixa (e o raio da taxa
 * fixa) é inclusivo ("até 1 km" vale para 1,000 km).
 */
export function calcularEntrega(loja: ConfigEntrega, destino: Coordenada, distanciaLiberada = true): ResultadoEntrega {
  if (!loja.fazEntrega) {
    return { disponivel: false, motivo: 'LOJA_SEM_ENTREGA' };
  }
  const entrega = entregaEmUso(loja, distanciaLiberada);
  if (entrega?.tipo === 'FIXA') {
    // Sem endereço da loja, o raio não tem de onde ser medido: vale para qualquer endereço.
    if (!loja.enderecoVerificado) {
      return { disponivel: true, distanciaKm: 0, taxa: entrega.taxa };
    }
    const distancia = distanciaKm(loja.enderecoVerificado, destino);
    if (entrega.raioKm !== undefined && distancia > entrega.raioKm) {
      return { disponivel: false, distanciaKm: distancia, motivo: 'FORA_DA_AREA' };
    }
    return { disponivel: true, distanciaKm: distancia, taxa: entrega.taxa };
  }
  if (!loja.enderecoVerificado) {
    return { disponivel: false, motivo: 'LOJA_SEM_ENDERECO' };
  }
  if (!entrega) {
    return { disponivel: false, motivo: 'SEM_FAIXAS' };
  }

  const distancia = distanciaKm(loja.enderecoVerificado, destino);
  const faixa = [...entrega.faixas].sort((a, b) => a.ateKm - b.ateKm).find((candidata) => distancia <= candidata.ateKm);
  if (!faixa) {
    return { disponivel: false, distanciaKm: distancia, motivo: 'FORA_DA_AREA' };
  }
  return { disponivel: true, distanciaKm: distancia, taxa: faixa.taxa };
}

/** A loja tem como entregar (taxa fixa, ou endereço e faixas), ligada ou não. */
export function entregaConfigurada(loja: ConfigEntrega, distanciaLiberada = true): boolean {
  return entregaEmUso({ ...loja, fazEntrega: true }, distanciaLiberada) !== undefined;
}

/** "R$ 5,00 até 4 km" ou "R$ 5,00". */
export function descreverTaxaFixa(entrega: Extract<EntregaEmUso, { tipo: 'FIXA' }>): string {
  const valor = entrega.taxa === 0 ? 'grátis' : `R$ ${entrega.taxa.toFixed(2).replace('.', ',')}`;
  return entrega.raioKm !== undefined ? `${valor} até ${formatarKm(entrega.raioKm)}` : valor;
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
