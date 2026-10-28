import { diaEMes, diaNoFuso, inicioDoDiaNoFuso, intervaloDoMes } from '../../planos/domain/calendario.js';
import { diaEMinutoNoFuso } from '../../promocoes/domain/promocao.js';

export type TipoRelatorio = 'SEMANAL' | 'DIARIO';

export interface Intervalo {
  de: Date;
  ate: Date;
}

/** Um período do relatório e o de comparação (o anterior, de mesmo tamanho). */
export interface PeriodoDoRelatorio extends Intervalo {
  titulo: string;
  anterior: Intervalo;
  /** "a semana anterior", para a linha das setas. */
  comparacao: string;
  /** Chave do envio agendado ("2026-10-19"): o mesmo relatório não sai duas vezes. */
  chave: string;
}

/** Envio automático: semanal na segunda às 9h; diário às 8h (fuso da loja). */
export const HORA_DO_SEMANAL = 9;
export const HORA_DO_DIARIO = 8;

/** "2026-10-27" + n dias. */
function somarDias(dia: string, dias: number): string {
  const [ano = 0, mes = 1, d = 1] = dia.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, d + dias)).toISOString().slice(0, 10);
}

function inicio(dia: string, fuso: string): Date {
  return inicioDoDiaNoFuso(dia, fuso);
}

/** Segunda a domingo da semana passada, comparada com a semana antes dela. */
export function semanaPassada(agora: Date, fuso: string): PeriodoDoRelatorio {
  const hoje = diaNoFuso(agora, fuso);
  const { dia } = diaEMinutoNoFuso(agora, fuso);
  const segundaDestaSemana = somarDias(hoje, -((dia + 6) % 7));
  const segundaPassada = somarDias(segundaDestaSemana, -7);
  const de = inicio(segundaPassada, fuso);
  const ate = inicio(segundaDestaSemana, fuso);
  return {
    de,
    ate,
    anterior: { de: inicio(somarDias(segundaPassada, -7), fuso), ate: de },
    titulo: `Vendas da semana (${diaEMes(de, fuso)} a ${diaEMes(new Date(ate.getTime() - 1), fuso)})`,
    comparacao: 'a semana anterior',
    chave: segundaPassada,
  };
}

/** O dia de ontem inteiro, comparado com anteontem. */
export function ontem(agora: Date, fuso: string): PeriodoDoRelatorio {
  const hoje = diaNoFuso(agora, fuso);
  const diaDeOntem = somarDias(hoje, -1);
  const de = inicio(diaDeOntem, fuso);
  return {
    de,
    ate: inicio(hoje, fuso),
    anterior: { de: inicio(somarDias(diaDeOntem, -1), fuso), ate: de },
    titulo: `Vendas de ontem (${diaEMes(de, fuso)})`,
    comparacao: 'anteontem',
    chave: diaDeOntem,
  };
}

/** Hoje até agora, comparado com ontem até a mesma hora. */
export function hojeAteAgora(agora: Date, fuso: string): PeriodoDoRelatorio {
  const de = inicio(diaNoFuso(agora, fuso), fuso);
  const umDia = 24 * 60 * 60_000;
  return {
    de,
    ate: agora,
    anterior: { de: new Date(de.getTime() - umDia), ate: new Date(agora.getTime() - umDia) },
    titulo: `Vendas de hoje (até agora)`,
    comparacao: 'ontem até esta hora',
    chave: diaNoFuso(agora, fuso),
  };
}

/** Os últimos 7 dias, comparados com os 7 antes deles. */
export function ultimos7Dias(agora: Date, fuso: string): PeriodoDoRelatorio {
  const semana = 7 * 24 * 60 * 60_000;
  const de = new Date(agora.getTime() - semana);
  return {
    de,
    ate: agora,
    anterior: { de: new Date(de.getTime() - semana), ate: de },
    titulo: `Vendas dos últimos 7 dias (${diaEMes(de, fuso)} a ${diaEMes(agora, fuso)})`,
    comparacao: 'os 7 dias anteriores',
    chave: diaNoFuso(agora, fuso),
  };
}

/** Do dia 1 até agora, comparado com o mesmo trecho do mês passado. */
export function mesAteAgora(agora: Date, fuso: string): PeriodoDoRelatorio {
  const { inicio: de } = intervaloDoMes(agora, fuso);
  const { inicio: deAnterior } = intervaloDoMes(new Date(de.getTime() - 1), fuso);
  const decorrido = agora.getTime() - de.getTime();
  return {
    de,
    ate: agora,
    anterior: { de: deAnterior, ate: new Date(Math.min(deAnterior.getTime() + decorrido, de.getTime())) },
    titulo: `Vendas do mês (${diaEMes(de, fuso)} até hoje)`,
    comparacao: 'o mesmo trecho do mês passado',
    chave: diaNoFuso(agora, fuso),
  };
}

/** Os envios automáticos que já podem sair agora (cada um só uma vez pela chave). */
export function relatoriosDoMomento(agora: Date, fuso: string): { tipo: TipoRelatorio; periodo: PeriodoDoRelatorio }[] {
  const { dia, minuto } = diaEMinutoNoFuso(agora, fuso);
  const hora = Math.floor(minuto / 60);
  return [
    ...(dia === 1 && hora >= HORA_DO_SEMANAL ? [{ tipo: 'SEMANAL' as const, periodo: semanaPassada(agora, fuso) }] : []),
    ...(hora >= HORA_DO_DIARIO ? [{ tipo: 'DIARIO' as const, periodo: ontem(agora, fuso) }] : []),
  ];
}
