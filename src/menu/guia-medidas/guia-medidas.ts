/** Tabela de medidas em cm: uma linha por tamanho, uma medida por coluna. */
export interface GuiaMedidas {
  nome: string;
  colunas: string[];
  linhas: { tamanho: string; medidas: number[] }[];
}

/** De uma categoria ou de um produto (o do produto vale primeiro na vitrine). */
export type AlvoDoGuia = { tipo: 'CATEGORIA'; id: string } | { tipo: 'ITEM'; id: string };

export const MAX_COLUNAS = 6;
export const MAX_LINHAS = 15;
const MAIOR_MEDIDA_CM = 300;

/** Motivos para recusar a tabela; vazio = pode mostrar para confirmar. */
export function problemasDoGuia(guia: GuiaMedidas): string[] {
  const problemas: string[] = [];
  if (guia.colunas.length === 0 || guia.colunas.length > MAX_COLUNAS) {
    problemas.push(`a tabela precisa de 1 a ${MAX_COLUNAS} medidas (ex.: busto, cintura, comprimento)`);
  }
  if (guia.linhas.length === 0 || guia.linhas.length > MAX_LINHAS) {
    problemas.push(`a tabela precisa de 1 a ${MAX_LINHAS} tamanhos`);
  }
  const tamanhos = guia.linhas.map((linha) => linha.tamanho.trim().toUpperCase());
  if (new Set(tamanhos).size !== tamanhos.length) {
    problemas.push('tem tamanho repetido');
  }
  for (const linha of guia.linhas) {
    if (linha.medidas.length !== guia.colunas.length) {
      problemas.push(`o tamanho ${linha.tamanho} tem ${linha.medidas.length} medidas, mas a tabela tem ${guia.colunas.length} colunas`);
    } else if (linha.medidas.some((medida) => !Number.isFinite(medida) || medida <= 0 || medida > MAIOR_MEDIDA_CM)) {
      problemas.push(`as medidas do tamanho ${linha.tamanho} precisam ser em cm, entre 0 e ${MAIOR_MEDIDA_CM}`);
    }
  }
  return problemas;
}

function cm(valor: number): string {
  return String(Math.round(valor * 10) / 10).replace('.', ',');
}

/** A tabela em texto para o WhatsApp, com monoespaço para alinhar. */
export function tabelaEmTexto(guia: GuiaMedidas): string {
  const cabecalho = ['Tam.', ...guia.colunas];
  const linhas = guia.linhas.map((linha) => [linha.tamanho, ...linha.medidas.map(cm)]);
  const larguras = cabecalho.map((titulo, coluna) => Math.max(titulo.length, ...linhas.map((linha) => linha[coluna]!.length)));
  const formatar = (celulas: string[]) => celulas.map((celula, coluna) => celula.padEnd(larguras[coluna]!)).join('  ').trimEnd();
  return ['```', formatar(cabecalho), ...linhas.map(formatar), '```', '_medidas em cm_'].join('\n');
}

/** O guia que o produto mostra: o dele, senão o da categoria. */
export function guiaDoItem(
  item: { id: string; categoriaId?: string },
  guias: { itemId: string | null; categoriaId: string | null; guia: GuiaMedidas }[],
): GuiaMedidas | undefined {
  return (
    guias.find((registro) => registro.itemId === item.id)?.guia ??
    (item.categoriaId ? guias.find((registro) => registro.categoriaId === item.categoriaId)?.guia : undefined)
  );
}
