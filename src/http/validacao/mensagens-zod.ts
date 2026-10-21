import { z } from 'zod';

const NOME_DO_TIPO: Record<string, string> = {
  string: 'um texto',
  number: 'um número',
  boolean: 'verdadeiro ou falso',
  object: 'um objeto',
  array: 'uma lista',
};

/** Mensagens curtas e em português para os erros de validação mais comuns. */
function mensagemAmigavel(issue: z.core.$ZodRawIssue): string | undefined {
  switch (issue.code) {
    case 'invalid_type':
      return issue.input === undefined ? 'é obrigatório' : `deve ser ${NOME_DO_TIPO[issue.expected] ?? issue.expected}`;
    case 'too_small':
      if (issue.origin === 'string')
        return Number(issue.minimum) <= 1
          ? 'não pode ficar vazio'
          : `precisa ter pelo menos ${issue.minimum} caracteres`;
      if (issue.origin === 'array')
        return `precisa ter pelo menos ${issue.minimum} ${Number(issue.minimum) === 1 ? 'item' : 'itens'}`;
      return issue.inclusive ? `deve ser no mínimo ${issue.minimum}` : `deve ser maior que ${issue.minimum}`;
    case 'too_big':
      if (issue.origin === 'string') return `pode ter no máximo ${issue.maximum} caracteres`;
      if (issue.origin === 'array') return `pode ter no máximo ${issue.maximum} itens`;
      return `deve ser no máximo ${issue.maximum}`;
    case 'invalid_value':
      return `deve ser um destes: ${issue.values.map(String).join(', ')}`;
    default:
      return undefined;
  }
}

/** Liga as mensagens em português do zod (as amigáveis acima, e o locale pt para o resto). */
export function configurarMensagensDeValidacao(): void {
  z.config(z.locales.pt());
  z.config({ customError: mensagemAmigavel });
}

/** `{ "itens.0.quantidade": "deve ser maior que 0" }`: um erro por campo, com o caminho completo. */
export function detalhesDaValidacao(erro: z.ZodError): { campos: Record<string, string> } {
  const campos: Record<string, string> = {};
  for (const issue of erro.issues) {
    const campo = issue.path.join('.') || 'corpo';
    campos[campo] ??= issue.message;
  }
  return { campos };
}
