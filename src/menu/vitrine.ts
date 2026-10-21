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

export interface CorDaPaleta {
  nome: string;
  hex: string;
}

/**
 * Cores que a loja pode escolher. Todas têm contraste AA com o fundo claro do
 * cardápio e ficam boas na faixa da capa, então o lojista não tem como errar.
 */
export const PALETA_DA_LOJA: readonly CorDaPaleta[] = [
  { nome: 'Vermelho', hex: '#C62828' },
  { nome: 'Laranja', hex: '#C2410C' },
  { nome: 'Mostarda', hex: '#975C06' },
  { nome: 'Verde', hex: '#1F7A4D' },
  { nome: 'Azul', hex: '#1D4ED8' },
  { nome: 'Roxo', hex: '#7E22CE' },
  { nome: 'Rosa', hex: '#BE185D' },
  { nome: 'Preto', hex: '#262626' },
];

const APELIDOS_DE_COR: Record<string, string> = {
  amarelo: 'Mostarda',
  dourado: 'Mostarda',
  marrom: 'Mostarda',
  vinho: 'Vermelho',
  bordo: 'Vermelho',
  pink: 'Rosa',
  lilas: 'Roxo',
  violeta: 'Roxo',
  cinza: 'Preto',
  grafite: 'Preto',
};

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

/** Matiz (0–360), saturação e luminosidade (0–1) de um "#RRGGBB". */
function hsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((inicio) => parseInt(hex.slice(inicio, inicio + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const maior = Math.max(r, g, b);
  const menor = Math.min(r, g, b);
  const luz = (maior + menor) / 2;
  const delta = maior - menor;
  if (delta === 0) {
    return [0, 0, luz];
  }
  const saturacao = delta / (1 - Math.abs(2 * luz - 1));
  const matiz =
    maior === r ? ((g - b) / delta) % 6 : maior === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [(matiz * 60 + 360) % 360, saturacao, luz];
}

/** A cor da paleta com o matiz mais parecido. Cores quase sem cor viram preto. */
function maisParecida(hex: string): CorDaPaleta {
  const [matiz, saturacao, luz] = hsl(hex);
  const coloridas = PALETA_DA_LOJA.filter((cor) => cor.nome !== 'Preto');
  if (saturacao < 0.2 || luz < 0.12 || luz > 0.95) {
    return PALETA_DA_LOJA.find((cor) => cor.nome === 'Preto')!;
  }
  const distancia = (cor: CorDaPaleta) => {
    const diferenca = Math.abs(hsl(cor.hex)[0] - matiz);
    return Math.min(diferenca, 360 - diferenca);
  };
  return coloridas.reduce((melhor, cor) => (distancia(cor) < distancia(melhor) ? cor : melhor));
}

/**
 * Lê a cor que o lojista pediu: nome da paleta ("laranja"), número da lista
 * ("3") ou um código hex, que é trocado pela cor da paleta mais parecida.
 * null se não der para entender.
 */
export function corDaPaleta(pedido: string): { cor: CorDaPaleta; aproximada: boolean } | null {
  const texto = semAcento(pedido);
  const numero = /^\d+$/.test(texto) ? PALETA_DA_LOJA[Number(texto) - 1] : undefined;
  if (numero) {
    return { cor: numero, aproximada: false };
  }
  const nome = APELIDOS_DE_COR[texto] ?? texto;
  const pelaPalavra = PALETA_DA_LOJA.find((cor) => semAcento(cor.nome) === semAcento(nome));
  if (pelaPalavra) {
    return { cor: pelaPalavra, aproximada: false };
  }
  const hex = normalizarCor(pedido);
  if (!hex) {
    return null;
  }
  const cor = maisParecida(hex);
  return { cor, aproximada: cor.hex !== hex };
}

/** "Laranja" para uma cor da paleta; o próprio hex para cores antigas, de antes da paleta. */
export function nomeDaCor(hex: string): string {
  return PALETA_DA_LOJA.find((cor) => cor.hex === hex.toUpperCase())?.nome ?? hex;
}

/** "1. Vermelho · 2. Laranja · …", para a IA oferecer as opções. */
export function listaDaPaleta(): string {
  return PALETA_DA_LOJA.map((cor, i) => `${i + 1}. ${cor.nome}`).join(' · ');
}
