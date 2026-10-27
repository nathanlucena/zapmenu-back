import { limite, podeUsar } from '../domain/assinatura.js';
import { mesNoFuso } from '../domain/calendario.js';
import type { Recurso } from '../domain/catalogo.js';
import type { AssinaturasRepository, ChaveDeCota } from './ports/assinaturas.repository.js';

/** Quanto cada cota vale na unidade guardada: áudio em segundos, sugestões em unidades. */
const ESCALA: Record<ChaveDeCota, number> = { minutosAudioMes: 60, sugestoesIaMes: 1 };

export type SituacaoDaCota =
  | { ok: true; empreendedorId: string; mes: string; restante: number | null }
  | { ok: false; motivo: 'SEM_RECURSO' | 'COTA_ESGOTADA' | 'LOJA_NAO_ENCONTRADA' };

/**
 * Antes de gastar (transcrever, pedir sugestão à IA): a loja tem o recurso e
 * ainda cabe `quantidade` na cota do mês? `quantidade` na unidade guardada.
 */
export async function conferirCota(
  repo: Pick<AssinaturasRepository, 'obterOuIniciarTeste' | 'usoDaCota'>,
  identificador: string,
  recurso: Recurso,
  chave: ChaveDeCota,
  quantidade: number,
  agora: Date = new Date(),
): Promise<SituacaoDaCota> {
  const encontrada = await repo.obterOuIniciarTeste(identificador, agora);
  if (!encontrada) {
    return { ok: false, motivo: 'LOJA_NAO_ENCONTRADA' };
  }
  const { loja, assinatura } = encontrada;
  if (!podeUsar(assinatura, recurso)) {
    return { ok: false, motivo: 'SEM_RECURSO' };
  }
  const mes = mesNoFuso(agora, loja.fuso);
  const maximo = limite(assinatura, chave);
  if (maximo === null) {
    return { ok: true, empreendedorId: loja.empreendedorId, mes, restante: null };
  }
  const usado = await repo.usoDaCota(loja.empreendedorId, chave, mes);
  const restante = maximo * ESCALA[chave] - usado;
  return restante >= quantidade
    ? { ok: true, empreendedorId: loja.empreendedorId, mes, restante }
    : { ok: false, motivo: 'COTA_ESGOTADA' };
}

/** Depois de gastar de verdade. */
export async function registrarUsoDaCota(
  repo: Pick<AssinaturasRepository, 'somarUsoDaCota'>,
  cota: Extract<SituacaoDaCota, { ok: true }>,
  chave: ChaveDeCota,
  quantidade: number,
): Promise<void> {
  await repo.somarUsoDaCota(cota.empreendedorId, chave, cota.mes, quantidade);
}
