/** Datas no fuso da loja: o "mês" dos limites e o "dia" dos avisos seguem o relógio dela. */

export const UM_DIA_MS = 24 * 60 * 60_000;

function partesNoFuso(instante: Date, fuso: string): { ano: number; mes: number; dia: number; hora: number; minuto: number; segundo: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instante);
  const valor = (tipo: string) => Number(partes.find((parte) => parte.type === tipo)?.value ?? 0);
  return { ano: valor('year'), mes: valor('month'), dia: valor('day'), hora: valor('hour'), minuto: valor('minute'), segundo: valor('second') };
}

/** Quanto o relógio do fuso está à frente do UTC nesse instante (negativo no Brasil). */
function deslocamentoMs(instante: Date, fuso: string): number {
  const p = partesNoFuso(instante, fuso);
  return Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo) - Math.floor(instante.getTime() / 1000) * 1000;
}

/** Instante da meia-noite do dia 1 de `mes` (1–12) no fuso. */
function meiaNoiteDoDiaPrimeiro(ano: number, mes: number, fuso: string): Date {
  const comoUtc = Date.UTC(ano, mes - 1, 1);
  const palpite = new Date(comoUtc - deslocamentoMs(new Date(comoUtc), fuso));
  // Segunda passada para o caso de o deslocamento mudar entre o palpite e a meia-noite (horário de verão).
  return new Date(comoUtc - deslocamentoMs(palpite, fuso));
}

/** "2026-10": o mês corrente no fuso da loja. */
export function mesNoFuso(agora: Date, fuso: string): string {
  const { ano, mes } = partesNoFuso(agora, fuso);
  return `${ano}-${String(mes).padStart(2, '0')}`;
}

/** "2026-10-27": o dia corrente no fuso da loja. */
export function diaNoFuso(agora: Date, fuso: string): string {
  const { ano, mes, dia } = partesNoFuso(agora, fuso);
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Começo e fim (exclusivo) do mês corrente no fuso da loja. */
export function intervaloDoMes(agora: Date, fuso: string): { inicio: Date; fim: Date } {
  const { ano, mes } = partesNoFuso(agora, fuso);
  return {
    inicio: meiaNoiteDoDiaPrimeiro(ano, mes, fuso),
    fim: mes === 12 ? meiaNoiteDoDiaPrimeiro(ano + 1, 1, fuso) : meiaNoiteDoDiaPrimeiro(ano, mes + 1, fuso),
  };
}

/** "27/10" no fuso da loja, para as mensagens. */
export function diaEMes(data: Date, fuso: string): string {
  const { mes, dia } = partesNoFuso(data, fuso);
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`;
}

/** Instante da meia-noite que começa o dia "2026-11-30" no fuso. */
export function inicioDoDiaNoFuso(dia: string, fuso: string): Date {
  const [ano = 0, mes = 1, d = 1] = dia.split('-').map(Number);
  const comoUtc = Date.UTC(ano, mes - 1, d);
  const palpite = new Date(comoUtc - deslocamentoMs(new Date(comoUtc), fuso));
  return new Date(comoUtc - deslocamentoMs(palpite, fuso));
}

/** Último milissegundo do dia "2026-11-30" no fuso ("até o dia 30" inclui o dia 30). */
export function fimDoDiaNoFuso(dia: string, fuso: string): Date {
  const [ano = 0, mes = 1, d = 1] = dia.split('-').map(Number);
  const seguinte = new Date(Date.UTC(ano, mes - 1, d + 1)).toISOString().slice(0, 10);
  return new Date(inicioDoDiaNoFuso(seguinte, fuso).getTime() - 1);
}
