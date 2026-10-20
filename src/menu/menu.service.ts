import { DomainError } from '../shared/errors/domain-error.js';
import type { MenuRepository } from './menu.repository.js';
import type { ItemCardapio, ItemDraft, VariacaoInput } from './menu.types.js';

export function lojaNaoEncontrada(): DomainError {
  return new DomainError('Loja não encontrada.', 'LOJA_NAO_ENCONTRADA', 'NAO_ENCONTRADO');
}

export function validarVariacao(variacao: VariacaoInput): string[] {
  const erros: string[] = [];

  if (!variacao.nome.trim()) {
    erros.push('Variação precisa de um nome (ex: "Tamanho").');
  }
  if (variacao.opcoes.length === 0) {
    erros.push(`Variação "${variacao.nome}" precisa de ao menos uma opção.`);
  }
  for (const opcao of variacao.opcoes) {
    if (!opcao.nome.trim()) {
      erros.push(`Opção da variação "${variacao.nome}" precisa de um nome.`);
    }
    if (opcao.precoAdicional < 0) {
      erros.push(`Opção "${opcao.nome}" não pode ter preço adicional negativo.`);
    }
  }

  return erros;
}

export function validarItemDraft(draft: ItemDraft): string[] {
  const erros: string[] = [];

  if (!draft.nome.trim()) {
    erros.push('Item precisa de um nome.');
  }
  if (draft.precoBase < 0) {
    erros.push('Preço base não pode ser negativo.');
  }
  for (const variacao of draft.variacoes) {
    erros.push(...validarVariacao(variacao));
  }

  return erros;
}

export function montarPreview(draft: ItemDraft): string {
  const linhas = [`*${draft.nome}*`];

  if (draft.descricao) {
    linhas.push(draft.descricao);
  }

  linhas.push(`Preço: R$ ${draft.precoBase.toFixed(2)}`);

  for (const variacao of draft.variacoes) {
    const opcoesTexto = variacao.opcoes
      .map((opcao) =>
        opcao.precoAdicional > 0
          ? `${opcao.nome} (+R$ ${opcao.precoAdicional.toFixed(2)})`
          : opcao.nome,
      )
      .join(', ');
    linhas.push(`${variacao.nome}: ${opcoesTexto}`);
  }

  if (draft.imagemUrl) {
    linhas.push('[imagem anexada]');
  }

  return linhas.join('\n');
}

export async function criarItem(
  repositorio: MenuRepository,
  empreendedorId: string,
  draft: ItemDraft,
): Promise<ItemCardapio> {
  const erros = validarItemDraft(draft);
  if (erros.length > 0) {
    throw new DomainError(erros.join(' '), 'ITEM_INVALIDO');
  }

  const cardapio = await repositorio.obterOuCriarCardapio(empreendedorId);
  return repositorio.adicionarItem(cardapio.id, draft);
}

/**
 * Preço de uma unidade do item com as opções escolhidas. `escolha` mapeia o
 * nome da variação para o nome da opção (ex.: { Tamanho: "G" }). O preço vem
 * sempre do cardápio — nunca do que o cliente enviou.
 */
export function calcularPrecoUnitario(item: ItemCardapio, escolha: Record<string, unknown> = {}): number {
  const nomesVariacoes = new Set(item.variacoes.map((variacao) => variacao.nome));
  for (const nome of Object.keys(escolha)) {
    if (!nomesVariacoes.has(nome)) {
      throw new DomainError(`"${item.nome}" não tem a opção "${nome}".`, 'VARIACAO_INVALIDA');
    }
  }

  let preco = item.precoBase;
  for (const variacao of item.variacoes) {
    const escolhida = escolha[variacao.nome];
    const opcao = variacao.opcoes.find((candidata) => candidata.nome === escolhida);
    if (!opcao) {
      throw new DomainError(`Escolha uma opção de "${variacao.nome}" para "${item.nome}".`, 'VARIACAO_INVALIDA');
    }
    preco += opcao.precoAdicional;
  }
  return Math.round(preco * 100) / 100;
}
