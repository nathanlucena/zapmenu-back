import type {
  Contexto,
  DadosLoja,
  FaixaEntrega,
  Horario,
  NovoItem,
  Rascunho,
  Variacao,
} from '../conversation/conversation-state.types.js';
import { DIAS_SEMANA, rascunhoVazio } from '../conversation/conversation-state.types.js';
import { mesclarConsulta } from '../endereco/endereco.service.js';
import { faixasComTaxaDecrescente, formatarKm, validarFaixas } from '../entrega.js';
import type { SnapshotCardapio } from './gestao.repository.js';
import type { DadosItemOperacao, Operacao } from './interpretador.js';

// ---------------------------------------------------------------------------
// Aplicação das operações da IA
// ---------------------------------------------------------------------------

export interface AplicacaoOperacoes {
  contexto: Contexto;
  snapshot: SnapshotCardapio;
  /** Foto da mensagem atual, se houver. */
  fotoAtual?: string;
}

/**
 * Aplica as operações propostas pela IA ao rascunho, validando cada uma contra
 * o cardápio real. Operações que apontam para algo inexistente são ignoradas e
 * viram avisos para a pessoa. Devolve os avisos.
 */
export function aplicarOperacoes(aplicacao: AplicacaoOperacoes, operacoes: Operacao[]): string[] {
  const { contexto, snapshot } = aplicacao;
  const avisos = new Set<string>();
  // ref proposta pela IA → ref efetivamente usada (pode ser trocada se repetida).
  const refs = new Map<string, string>();
  let fotoAtual = aplicacao.fotoAtual;

  const itemExiste = (itemId: string) => snapshot.itens.some((item) => item.id === itemId);
  const categoriaExiste = (categoriaId: string) => snapshot.categorias.some((categoria) => categoria.id === categoriaId);
  const novoItem = (ref: string) => contexto.rascunho.novosItens.find((item) => item.ref === (refs.get(ref) ?? ref));
  const avisarItemDesconhecido = () =>
    avisos.add('⚠️ Não consegui identificar um dos itens que você citou. Mande *cardápio* para ver a lista.');

  for (const operacao of operacoes) {
    const rascunho = contexto.rascunho;

    switch (operacao.tipo) {
      case 'NOVO_ITEM': {
        const ref = refDisponivel(contexto, operacao.ref);
        if (operacao.ref) {
          refs.set(operacao.ref, ref);
        }
        const item: NovoItem = { ref };
        mesclarDadosItem(item, operacao.dados);
        rascunho.novosItens.push(item);
        garantirCategoria(rascunho, snapshot, item.categoria);
        break;
      }
      case 'CORRIGIR_NOVO_ITEM': {
        const item = novoItem(operacao.ref);
        if (!item) {
          avisarItemDesconhecido();
          break;
        }
        mesclarDadosItem(item, operacao.dados);
        garantirCategoria(rascunho, snapshot, item.categoria);
        break;
      }
      case 'DESCARTAR_NOVO_ITEM': {
        const item = novoItem(operacao.ref);
        rascunho.novosItens = rascunho.novosItens.filter((candidato) => candidato !== item);
        break;
      }
      case 'EDITAR_ITEM': {
        if (!itemExiste(operacao.itemId)) {
          avisarItemDesconhecido();
          break;
        }
        // Editar um item que estava marcado para remoção = desistiu de remover.
        rascunho.status = rascunho.status.filter(
          (status) => !(status.itemId === operacao.itemId && status.acao === 'REMOVER'),
        );
        let edicao = rascunho.edicoes.find((candidata) => candidata.itemId === operacao.itemId);
        if (!edicao) {
          edicao = { itemId: operacao.itemId };
          rascunho.edicoes.push(edicao);
        }
        mesclarDadosItem(edicao, operacao.dados);
        garantirCategoria(rascunho, snapshot, edicao.categoria);
        break;
      }
      case 'PAUSAR_ITEM':
      case 'REATIVAR_ITEM':
      case 'REMOVER_ITEM': {
        const item = snapshot.itens.find((candidato) => candidato.id === operacao.itemId);
        if (!item) {
          avisarItemDesconhecido();
          break;
        }
        const acao = operacao.tipo === 'PAUSAR_ITEM' ? 'PAUSAR' : operacao.tipo === 'REATIVAR_ITEM' ? 'REATIVAR' : 'REMOVER';
        rascunho.status = rascunho.status.filter((status) => status.itemId !== item.id);
        const semEfeito = (acao === 'PAUSAR' && !item.ativo) || (acao === 'REATIVAR' && item.ativo);
        if (!semEfeito) {
          rascunho.status.push({ itemId: item.id, acao });
        }
        if (acao === 'REMOVER') {
          rascunho.edicoes = rascunho.edicoes.filter((edicao) => edicao.itemId !== item.id);
        }
        break;
      }
      case 'DESFAZER_ITEM':
        rascunho.edicoes = rascunho.edicoes.filter((edicao) => edicao.itemId !== operacao.itemId);
        rascunho.status = rascunho.status.filter((status) => status.itemId !== operacao.itemId);
        break;
      case 'ANEXAR_FOTO': {
        const foto = fotoAtual ?? contexto.fotoPendente;
        if (!foto) {
          avisos.add('⚠️ Não recebi nenhuma foto para anexar. Pode mandar de novo?');
          break;
        }
        if (operacao.ref && novoItem(operacao.ref)) {
          novoItem(operacao.ref)!.imagemUrl = foto;
        } else if (operacao.itemId && itemExiste(operacao.itemId)) {
          let edicao = rascunho.edicoes.find((candidata) => candidata.itemId === operacao.itemId);
          if (!edicao) {
            edicao = { itemId: operacao.itemId };
            rascunho.edicoes.push(edicao);
          }
          edicao.imagemUrl = foto;
        } else {
          avisarItemDesconhecido();
          break;
        }
        if (fotoAtual) {
          fotoAtual = undefined;
        } else {
          contexto.fotoPendente = undefined;
        }
        break;
      }
      case 'NOVA_CATEGORIA':
        garantirCategoria(rascunho, snapshot, operacao.nome);
        break;
      case 'RENOMEAR_CATEGORIA':
        if (!categoriaExiste(operacao.categoriaId)) {
          avisos.add('⚠️ Não encontrei a categoria que você citou.');
          break;
        }
        rascunho.categoriasRenomeadas = [
          ...rascunho.categoriasRenomeadas.filter((renomeada) => renomeada.categoriaId !== operacao.categoriaId),
          { categoriaId: operacao.categoriaId, novoNome: operacao.novoNome },
        ];
        break;
      case 'REMOVER_CATEGORIA':
        if (!categoriaExiste(operacao.categoriaId)) {
          avisos.add('⚠️ Não encontrei a categoria que você citou.');
          break;
        }
        if (!rascunho.categoriasRemovidas.includes(operacao.categoriaId)) {
          rascunho.categoriasRemovidas.push(operacao.categoriaId);
        }
        break;
      case 'ATUALIZAR_LOJA': {
        const dados = { ...operacao.dados };
        if (dados.faixasEntrega !== undefined) {
          const validacao = validarFaixas(dados.faixasEntrega);
          validacao.avisos.forEach((aviso) => avisos.add(aviso));
          dados.faixasEntrega = validacao.faixas;
          // Configurar as faixas é começar a entregar, a menos que a pessoa tenha dito o contrário.
          const fazEntregaAtual = rascunho.loja?.fazEntrega ?? snapshot.loja.fazEntrega;
          if (validacao.faixas && dados.fazEntrega === undefined && !fazEntregaAtual) {
            dados.fazEntrega = true;
          }
        }
        rascunho.loja = { ...rascunho.loja, ...definidos(dados) };
        break;
      }
      case 'DEFINIR_ENDERECO':
        // Endereço novo invalida o que estava esperando confirmação; a busca é feita pelo serviço.
        contexto.consultaEndereco = mesclarConsulta(contexto.consultaEndereco, operacao.dados);
        contexto.enderecoPendente = undefined;
        break;
      case 'CONFIRMAR_ENDERECO':
        if (!confirmarEndereco(contexto)) {
          avisos.add('⚠️ Não há nenhum endereço esperando confirmação. Me manda o CEP e o número da loja.');
        }
        break;
      case 'RECUSAR_ENDERECO':
        recusarEndereco(contexto);
        break;
      case 'DESCARTAR_TUDO':
        contexto.rascunho = rascunhoVazio();
        contexto.fotoPendente = undefined;
        contexto.consultaEndereco = undefined;
        contexto.enderecoPendente = undefined;
        break;
    }
  }

  // Foto que nenhuma operação usou fica guardada para a IA anexar depois.
  if (fotoAtual) {
    contexto.fotoPendente = fotoAtual;
  }
  return [...avisos];
}

/** Passa o endereço confirmado para o rascunho. Devolve false se não havia nada pendente. */
export function confirmarEndereco(contexto: Contexto): boolean {
  const pendente = contexto.enderecoPendente;
  if (!pendente) {
    return false;
  }
  contexto.rascunho.loja = {
    ...contexto.rascunho.loja,
    enderecoVerificado: pendente.endereco,
    endereco: pendente.endereco.enderecoFormatado,
  };
  contexto.enderecoPendente = undefined;
  contexto.consultaEndereco = undefined;
  return true;
}

/** "Não é aqui": descarta o encontrado, mas guarda o que foi digitado para correções parciais. */
export function recusarEndereco(contexto: Contexto): void {
  contexto.enderecoPendente = undefined;
}

function refDisponivel(contexto: Contexto, proposta?: string): string {
  const usadas = new Set(contexto.rascunho.novosItens.map((item) => item.ref));
  if (proposta && /^n\d+$/.test(proposta) && !usadas.has(proposta)) {
    contexto.proximaRef = Math.max(contexto.proximaRef, Number(proposta.slice(1)) + 1);
    return proposta;
  }
  let ref = `n${contexto.proximaRef}`;
  while (usadas.has(ref)) {
    ref = `n${++contexto.proximaRef}`;
  }
  contexto.proximaRef++;
  return ref;
}

function mesclarDadosItem(alvo: { categoria?: string | null } & Omit<DadosItemOperacao, 'categoria'>, dados: DadosItemOperacao): void {
  Object.assign(alvo, definidos({ ...dados, categoria: undefined }));
  if (dados.categoria !== undefined) {
    alvo.categoria = dados.categoria;
  }
}

/** Categoria citada por nome que ainda não existe entra como "nova" no rascunho. */
function garantirCategoria(rascunho: Rascunho, snapshot: SnapshotCardapio, nome?: string | null): void {
  if (!nome) {
    return;
  }
  const chave = nome.trim().toLowerCase();
  const conhecidas = [
    ...snapshot.categorias.filter((categoria) => !rascunho.categoriasRemovidas.includes(categoria.id)).map((categoria) => categoria.nome),
    ...rascunho.categoriasRenomeadas.map((renomeada) => renomeada.novoNome),
    ...rascunho.novasCategorias,
  ];
  if (!conhecidas.some((conhecida) => conhecida.trim().toLowerCase() === chave)) {
    rascunho.novasCategorias.push(nome.trim());
  }
}

// ---------------------------------------------------------------------------
// Validação e resumo
// ---------------------------------------------------------------------------

export function estaVazio(rascunho: Rascunho): boolean {
  return contarAlteracoes(rascunho) === 0;
}

export function contarAlteracoes(rascunho: Rascunho): number {
  return (
    rascunho.novosItens.length +
    rascunho.edicoes.length +
    rascunho.status.length +
    rascunho.novasCategorias.length +
    rascunho.categoriasRenomeadas.length +
    rascunho.categoriasRemovidas.length +
    (rascunho.loja && Object.keys(definidos(rascunho.loja)).length > 0 ? 1 : 0)
  );
}

/** O que falta para o rascunho poder ser salvo (vazio = pode salvar). */
export function pendenciasParaSalvar(contexto: Contexto, snapshot: SnapshotCardapio): string[] {
  const { rascunho } = contexto;
  const pendencias: string[] = [];
  if (contexto.enderecoPendente) {
    pendencias.push(
      `confirmar se o endereço *${contexto.enderecoPendente.endereco.enderecoFormatado}* está certo (*sim*/*não*)`,
    );
  }
  for (const item of rascunho.novosItens) {
    if (!item.nome) {
      pendencias.push(`um item novo está sem nome${item.precoBase !== undefined ? ` (o de ${formatarPreco(item.precoBase)})` : ''}`);
    } else if (item.precoBase === undefined) {
      pendencias.push(`o preço de *${item.nome}*`);
    }
  }

  // Só cobra endereço e faixas quando a conversa mexeu na entrega: editar um
  // preço numa loja antiga (entrega por taxa fixa) não pode ficar travado.
  const loja = rascunho.loja;
  const mexeuNaEntrega = loja?.fazEntrega === true || loja?.faixasEntrega !== undefined;
  const fazEntrega = loja?.fazEntrega ?? snapshot.loja.fazEntrega;
  if (mexeuNaEntrega && fazEntrega) {
    if (!(loja?.enderecoVerificado ?? snapshot.loja.enderecoVerificado) && !contexto.enderecoPendente) {
      pendencias.push('o CEP e o número da loja (para calcular a distância das entregas)');
    }
    if (!(loja?.faixasEntrega ?? snapshot.loja.faixasEntrega)?.length) {
      pendencias.push('até onde você entrega e quanto cobra (ex.: _até 1 km grátis, até 3 km R$ 5_)');
    }
  }
  return pendencias;
}

/** Lista legível das alterações; é exatamente o que será gravado. */
export function descreverAlteracoes(rascunho: Rascunho, snapshot: SnapshotCardapio): string[] {
  const linhas: string[] = [];
  const item = (itemId: string) => snapshot.itens.find((candidato) => candidato.id === itemId);
  const categoria = (categoriaId: string) => snapshot.categorias.find((candidata) => candidata.id === categoriaId)?.nome ?? '?';

  if (rascunho.loja) {
    linhas.push(...descreverLoja(rascunho.loja, snapshot.loja));
  }
  for (const nome of rascunho.novasCategorias) {
    linhas.push(`🗂️ Nova categoria: *${nome}*`);
  }
  for (const { categoriaId, novoNome } of rascunho.categoriasRenomeadas) {
    linhas.push(`🗂️ Renomear categoria: ${categoria(categoriaId)} → *${novoNome}*`);
  }
  for (const categoriaId of rascunho.categoriasRemovidas) {
    linhas.push(`🗂️ Remover categoria: *${categoria(categoriaId)}* (os itens dela vão para "Outros")`);
  }

  for (const novo of rascunho.novosItens) {
    const extras = [novo.categoria && `(${novo.categoria})`, novo.imagemUrl ? '📷' : '(sem foto)'].filter(Boolean).join(' ');
    linhas.push(`➕ *${novo.nome ?? 'sem nome'}* — ${novo.precoBase !== undefined ? formatarPreco(novo.precoBase) : 'sem preço'} ${extras}`);
    if (novo.descricao) {
      linhas.push(`   _${novo.descricao}_`);
    }
    linhas.push(...descreverVariacoes(novo.variacoes));
  }

  for (const edicao of rascunho.edicoes) {
    const atual = item(edicao.itemId);
    const mudancas: string[] = [];
    if (edicao.nome !== undefined) mudancas.push(`nome → *${edicao.nome}*`);
    if (edicao.precoBase !== undefined) {
      mudancas.push(`preço ${atual ? formatarPreco(atual.precoBase) : ''} → *${formatarPreco(edicao.precoBase)}*`);
    }
    if (edicao.descricao !== undefined) mudancas.push(`descrição → _${edicao.descricao}_`);
    if (edicao.categoria !== undefined) mudancas.push(`categoria → *${edicao.categoria ?? 'Outros'}*`);
    if (edicao.imagemUrl !== undefined) mudancas.push('nova foto 📷');
    if (edicao.variacoes !== undefined) mudancas.push('variações:');
    linhas.push(`✏️ *${atual?.nome ?? 'item'}*: ${mudancas.join(' · ') || 'sem mudanças'}`);
    if (edicao.variacoes !== undefined) {
      linhas.push(...(edicao.variacoes.length ? descreverVariacoes(edicao.variacoes) : ['   (sem variações)']));
    }
  }

  const iconeStatus = { PAUSAR: '⏸️', REATIVAR: '▶️', REMOVER: '🗑️' } as const;
  const verboStatus = { PAUSAR: 'pausar', REATIVAR: 'reativar', REMOVER: 'remover' } as const;
  for (const { itemId, acao } of rascunho.status) {
    linhas.push(`${iconeStatus[acao]} *${item(itemId)?.nome ?? 'item'}* — ${verboStatus[acao]}`);
  }
  return linhas;
}

export function montarResumo(rascunho: Rascunho, snapshot: SnapshotCardapio): string {
  return [
    '📋 *Vou salvar estas alterações:*',
    ...descreverAlteracoes(rascunho, snapshot),
    '',
    'Confirma? (*sim*/*não*)',
  ].join('\n');
}

function descreverVariacoes(variacoes?: Variacao[]): string[] {
  return (variacoes ?? []).map(
    (variacao) =>
      `   ${variacao.nome}: ${variacao.opcoes
        .map((opcao) => (opcao.precoAdicional > 0 ? `${opcao.nome} (+${formatarPreco(opcao.precoAdicional)})` : opcao.nome))
        .join(', ')}`,
  );
}

function descreverLoja(loja: DadosLoja, atual: DadosLoja): string[] {
  const linhas: string[] = [];
  const simNao = (valor: boolean) => (valor ? 'sim' : 'não');
  if (loja.nome !== undefined) linhas.push(`🏪 Nome da loja: ${atual.nome ?? '—'} → *${loja.nome}*`);
  if (loja.descricao !== undefined) linhas.push(`🏪 Descrição: _${loja.descricao}_`);
  if (loja.enderecoVerificado !== undefined) {
    const anterior = atual.enderecoVerificado?.enderecoFormatado;
    linhas.push(`📍 Endereço: ${anterior ? `${anterior} → ` : ''}*${loja.enderecoVerificado.enderecoFormatado}*`);
  } else if (loja.endereco !== undefined) {
    linhas.push(`📍 Endereço: *${loja.endereco}*`);
  }
  if (loja.aceitaRetirada !== undefined) linhas.push(`🛍️ Aceita retirada: *${simNao(loja.aceitaRetirada)}*`);
  if (loja.fazEntrega !== undefined) linhas.push(`🛵 Faz entrega: *${simNao(loja.fazEntrega)}*`);
  if (loja.faixasEntrega !== undefined) {
    const anterior = atual.faixasEntrega?.length ? `${descreverFaixas(atual.faixasEntrega)} → ` : '';
    linhas.push(`🛵 Entrega: ${anterior}*${descreverFaixas(loja.faixasEntrega)}*`);
    for (const [perto, longe] of faixasComTaxaDecrescente(loja.faixasEntrega)) {
      linhas.push(
        `   ⚠️ a faixa de até ${formatarKm(longe.ateKm)} está mais barata que a de até ${formatarKm(perto.ateKm)}`,
      );
    }
  }
  if (loja.pedidoMinimo !== undefined) linhas.push(`🧾 Pedido mínimo: *${formatarPreco(loja.pedidoMinimo)}*`);
  if (loja.horarios !== undefined) linhas.push(`🕒 Horários: ${formatarHorarios(loja.horarios)}`);
  return linhas;
}

/** "até 1 km grátis · até 3 km R$ 5,00 · acima de 3 km não entrega". */
export function descreverFaixas(faixas: FaixaEntrega[]): string {
  if (faixas.length === 0) {
    return 'sem faixas (não entrega)';
  }
  const partes = faixas.map(
    (faixa) => `até ${formatarKm(faixa.ateKm)} ${faixa.taxa === 0 ? 'grátis' : formatarPreco(faixa.taxa)}`,
  );
  partes.push(`acima de ${formatarKm(faixas[faixas.length - 1]!.ateKm)} não entrega`);
  return partes.join(' · ');
}

/** Agrupa dias com o mesmo horário: "seg, ter, qua 18:00–23:00; sab 12:00–23:00". */
export function formatarHorarios(horarios: Horario[]): string {
  if (horarios.length === 0) {
    return '*sem horário (fechado)*';
  }
  const grupos = new Map<string, string[]>();
  const ordenados = [...horarios].sort((a, b) => DIAS_SEMANA.indexOf(a.dia) - DIAS_SEMANA.indexOf(b.dia));
  for (const { dia, abre, fecha } of ordenados) {
    const faixa = `${abre}–${fecha}`;
    grupos.set(faixa, [...(grupos.get(faixa) ?? []), dia]);
  }
  return [...grupos].map(([faixa, dias]) => `*${dias.join(', ')} ${faixa}*`).join('; ');
}

export function formatarPreco(valor: number): string {
  return `R$ ${valor.toFixed(2).replace('.', ',')}`;
}

/** Remove chaves com valor undefined (para merges não apagarem dados). */
export function definidos<T extends object>(dados: T): Partial<T> {
  return Object.fromEntries(Object.entries(dados).filter(([, valor]) => valor !== undefined)) as Partial<T>;
}
