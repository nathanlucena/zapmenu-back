import type { FotoProduto } from './menu.types.js';

/**
 * Fotos do produto na ordem da vitrine. Item sem galeria (todo item de comida)
 * mostra o `imagemUrl` como única foto, então o app só precisa ler `fotos`.
 */
export function fotosDoItem(galeria: FotoProduto[], imagemUrl?: string): FotoProduto[] {
  if (galeria.length > 0) {
    return [...galeria].sort((a, b) => a.ordem - b.ordem);
  }
  return imagemUrl ? [{ url: imagemUrl, ordem: 0 }] : [];
}
