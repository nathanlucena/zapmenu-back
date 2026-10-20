const TAMANHO_MAXIMO_SLUG = 40;
const SLUG_VALIDO = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const COR_HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** "Pizzaria do Zé!" → "pizzaria-do-ze". Pode voltar vazio (ex.: só emojis). */
export function gerarSlug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, TAMANHO_MAXIMO_SLUG)
    .replace(/^-+|-+$/g, '');
}

/**
 * Motivo para recusar o link, ou null se está ok. Precisa ter uma letra para
 * não ser confundido com um telefone, que também abre o cardápio.
 */
export function problemaNoSlug(slug: string): string | null {
  if (slug.length < 3) {
    return 'o link precisa ter pelo menos 3 letras ou números';
  }
  if (slug.length > TAMANHO_MAXIMO_SLUG || !SLUG_VALIDO.test(slug)) {
    return 'o link só pode ter letras, números e hífens';
  }
  if (!/[a-z]/.test(slug)) {
    return 'o link precisa ter pelo menos uma letra';
  }
  return null;
}

/** "#abc", "AABBCC" → "#AABBCC". null se não for uma cor hex. */
export function normalizarCor(cor: string): string | null {
  const encontrada = cor.trim().match(COR_HEX)?.[1];
  if (!encontrada) {
    return null;
  }
  const seis = encontrada.length === 3 ? [...encontrada].map((digito) => digito + digito).join('') : encontrada;
  return `#${seis.toUpperCase()}`;
}
