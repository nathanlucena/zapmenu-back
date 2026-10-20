import type { Prisma } from '@prisma/client';

/**
 * O app abre o cardápio pelo link curto da loja (slug) ou, como alternativa,
 * pelo telefone do empreendedor. Não há ambiguidade: o slug sempre tem uma letra.
 */
export function empreendedorPorIdentificador(identificador: string): Prisma.EmpreendedorWhereInput {
  return { OR: [{ telefone: identificador }, { loja: { slug: identificador } }] };
}
