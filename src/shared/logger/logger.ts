import pino from 'pino';

const emDesenvolvimento = (process.env.NODE_ENV ?? 'development') === 'development';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // Em dev o log sai formatado e colorido; em produção continua JSON (uma linha
  // por evento), que é o que agregadores de log esperam.
  ...(emDesenvolvimento && {
    transport: {
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname', singleLine: true },
    },
  }),
});

/** Encurta textos longos para caberem numa linha de log. */
export function trecho(texto: string, max = 80): string {
  const umaLinha = texto.replace(/\s+/g, ' ').trim();
  return umaLinha.length > max ? `${umaLinha.slice(0, max)}…` : umaLinha;
}
