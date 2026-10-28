import { normalizar } from './comandos.js';

export type DestinoDaFoto = 'ITEM' | 'CAPA' | 'LOGO';

/** Enquete quando chega foto sem legenda e não há item esperando foto. */
export const PERGUNTA_DESTINO_FOTO = 'Essa foto é para quê?';
export const OPCOES_DESTINO_FOTO = ['Foto de um item', 'Capa da loja', 'Logo da loja'] as const;

export function ehOpcaoDaFotoDaLoja(texto: string): boolean {
  return (OPCOES_DESTINO_FOTO as readonly string[]).includes(texto.trim());
}

/** Legenda maior que isso fala de mais coisas: fica com a IA. */
const PALAVRAS_DA_LEGENDA_CURTA = 6;

/** "essa é a capa", "foto pro banner" → CAPA; "esse é o logo", "logomarca" → LOGO. Só legenda curta. */
export function destinoDaLegenda(legenda: string): DestinoDaFoto | undefined {
  const texto = normalizar(legenda);
  if (texto.split(' ').length > PALAVRAS_DA_LEGENDA_CURTA) return undefined;
  if (/\b(capa|banner)\b/.test(texto)) return 'CAPA';
  if (/\b(logo|logomarca|logotipo|marca da loja)\b/.test(texto)) return 'LOGO';
  return undefined;
}

/** Resposta à enquete (ou escrita): capa, logo ou item. */
export function destinoDaResposta(resposta: string): DestinoDaFoto | undefined {
  const texto = normalizar(resposta);
  if (texto === normalizar(OPCOES_DESTINO_FOTO[0]) || /\b(item|produto|prato)\b/.test(texto) || texto === '1') return 'ITEM';
  if (texto === normalizar(OPCOES_DESTINO_FOTO[1]) || texto === '2') return 'CAPA';
  if (texto === normalizar(OPCOES_DESTINO_FOTO[2]) || texto === '3') return 'LOGO';
  return destinoDaLegenda(resposta);
}
