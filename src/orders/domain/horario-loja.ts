export const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;

export interface HorarioFuncionamento {
  dia: (typeof DIAS)[number];
  /** "HH:MM" */
  abre: string;
  /** "HH:MM". Menor ou igual a `abre` = vira a madrugada (ex.: 18:00 às 02:00). */
  fecha: string;
}

export const FUSO_PADRAO = 'America/Sao_Paulo';

function minutos(hhmm: string): number {
  const [horas = 0, mins = 0] = hhmm.split(':').map(Number);
  return horas * 60 + mins;
}

function diaEMinutoNoFuso(agora: Date, fuso: string): { dia: number; minuto: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora);
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parte('weekday'));
  return { dia, minuto: Number(parte('hour')) * 60 + Number(parte('minute')) };
}

/** Loja sem horários cadastrados não tem restrição: fica sempre aberta. */
export function lojaAberta(horarios: HorarioFuncionamento[], agora: Date, fuso = FUSO_PADRAO): boolean {
  if (horarios.length === 0) {
    return true;
  }
  const { dia, minuto } = diaEMinutoNoFuso(agora, fuso);
  const hoje = DIAS[dia];
  const ontem = DIAS[(dia + 6) % 7];

  return horarios.some((horario) => {
    const abre = minutos(horario.abre);
    const fecha = minutos(horario.fecha);
    const viraMadrugada = fecha <= abre;
    if (horario.dia === hoje) {
      return minuto >= abre && (viraMadrugada || minuto < fecha);
    }
    // A parte depois da meia-noite de um horário que começou ontem.
    return horario.dia === ontem && viraMadrugada && minuto < fecha;
  });
}
