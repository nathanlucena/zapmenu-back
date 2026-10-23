import type { DadosLoja } from '../conversation/conversation-state.types.js';
import type { SegmentoLoja } from '../menu.types.js';
import type { Operacao } from './interpretador.js';

/** Campos da loja que só existem no tipo Loja (varejo). */
const CAMPOS_SO_DA_LOJA = ['aceitaEnvio', 'freteEnvio', 'fretePorUf', 'politicaTroca'] as const satisfies readonly (keyof DadosLoja)[];

export const AVISO_SO_DA_LOJA =
  '⚠️ Tamanhos e cores com estoque, frete pelos Correios e política de troca são do tipo *Loja*. A sua está como *Cardápio*: para trocar, mande *mudar tipo da loja*.';
export const AVISO_SO_DO_CARDAPIO =
  '⚠️ Adicionais e variações com preço são do tipo *Cardápio*. Na *Loja*, tamanho e cor entram na grade com estoque (ex.: _P, M e G, 5 de cada_). Para trocar o tipo, mande *mudar tipo da loja*.';

/**
 * Tira das operações da IA tudo o que não pertence ao tipo da loja, para ela
 * não "sair da caixa" mesmo que o prompt seja ignorado. Devolve o que sobrou e
 * os avisos para a pessoa (no máximo um de cada).
 */
export function filtrarPorTipo(
  segmento: SegmentoLoja | undefined,
  operacoes: Operacao[],
): { operacoes: Operacao[]; avisos: string[] } {
  const avisos = new Set<string>();
  const varejo = segmento === 'VAREJO';
  const permitidas: Operacao[] = [];

  for (const operacao of operacoes) {
    switch (operacao.tipo) {
      case 'DEFINIR_GRADE':
        if (!varejo) {
          avisos.add(AVISO_SO_DA_LOJA);
          continue;
        }
        break;
      case 'NOVO_ITEM':
      case 'CORRIGIR_NOVO_ITEM':
      case 'EDITAR_ITEM':
        if (varejo && operacao.dados.variacoes !== undefined) {
          avisos.add(AVISO_SO_DO_CARDAPIO);
          const { variacoes: _variacoes, ...dados } = operacao.dados;
          permitidas.push({ ...operacao, dados });
          continue;
        }
        break;
      case 'ATUALIZAR_LOJA': {
        if (varejo) break;
        const proibidos = CAMPOS_SO_DA_LOJA.filter((campo) => operacao.dados[campo] !== undefined);
        if (proibidos.length === 0) break;
        avisos.add(AVISO_SO_DA_LOJA);
        const dados = { ...operacao.dados };
        for (const campo of proibidos) delete dados[campo];
        if (Object.values(dados).some((valor) => valor !== undefined)) {
          permitidas.push({ ...operacao, dados });
        }
        continue;
      }
    }
    permitidas.push(operacao);
  }
  return { operacoes: permitidas, avisos: [...avisos] };
}
