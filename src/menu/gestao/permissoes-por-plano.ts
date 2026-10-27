import { limite, planoEfetivo, podeUsar, type SituacaoDoPlano } from '../../planos/domain/assinatura.js';
import type { Recurso } from '../../planos/domain/catalogo.js';
import { mensagemLimiteDeProdutos, mensagemRecursoDoPlano } from '../../planos/application/mensagens.js';
import type { Operacao } from './interpretador.js';
import { recursoDaPromocao } from '../../promocoes/domain/promocao.js';

export const AVISO_TAXA_FIXA =
  '🛵 No seu plano a entrega é com *taxa fixa*: me diga um valor só e, se quiser, até quantos km entrega (ex.: _R$ 5 até 4 km_).';

export interface ContagemDeProdutos {
  /** Produtos salvos (ativos e pausados). */
  salvos: number;
  /** Produtos novos já anotados no rascunho. */
  noRascunho: number;
}

/**
 * Tira das operações da IA o que o plano da loja não inclui (entrega por
 * distância — a taxa fixa vale em todos —, cor e capa) e os produtos acima do limite, como o filtro por tipo
 * faz com o que é do outro tipo. Sem situação do plano (planos desligados), tudo passa.
 */
export function filtrarPorPlano(
  loja: SituacaoDoPlano | undefined,
  operacoes: Operacao[],
  produtos: ContagemDeProdutos,
  linkDosPlanos?: string,
): { operacoes: Operacao[]; avisos: string[] } {
  if (!loja) {
    return { operacoes, avisos: [] };
  }
  const avisos = new Set<string>();
  const bloquear = (recurso: Recurso) => avisos.add(mensagemRecursoDoPlano(recurso, linkDosPlanos));
  const maximoDeProdutos = limite(loja, 'produtos');
  let produtosContados = produtos.salvos + produtos.noRascunho;
  const refsRecusadas = new Set<string>();
  const permitidas: Operacao[] = [];

  for (const operacao of operacoes) {
    switch (operacao.tipo) {
      case 'NOVO_ITEM':
        if (maximoDeProdutos !== null && produtosContados >= maximoDeProdutos) {
          avisos.add(mensagemLimiteDeProdutos(maximoDeProdutos, planoEfetivo(loja), linkDosPlanos));
          if (operacao.ref) refsRecusadas.add(operacao.ref);
          continue;
        }
        produtosContados += 1;
        break;
      case 'CORRIGIR_NOVO_ITEM':
      case 'DESCARTAR_NOVO_ITEM':
      case 'ANEXAR_FOTO':
      case 'DEFINIR_GRADE':
        // O que viria junto de um produto recusado (foto, grade) cai com ele.
        if (operacao.ref && refsRecusadas.has(operacao.ref)) continue;
        break;
      case 'NOVA_PROMOCAO': {
        const recurso = recursoDaPromocao(operacao.promocao.tipo);
        if (!podeUsar(loja, recurso)) {
          bloquear(recurso);
          continue;
        }
        break;
      }
      case 'ANEXAR_FOTO_LOJA':
        if (operacao.destino === 'CAPA' && !podeUsar(loja, 'CORES_CAPA')) {
          bloquear('CORES_CAPA');
          continue;
        }
        break;
      case 'ATUALIZAR_LOJA': {
        const dados = { ...operacao.dados };
        if (dados.corDestaque !== undefined && !podeUsar(loja, 'CORES_CAPA')) {
          bloquear('CORES_CAPA');
          delete dados.corDestaque;
        }
        // Entregar com taxa fixa vale em qualquer plano; faixas por distância, só com o recurso.
        if ((dados.faixasEntrega !== undefined || dados.modoEntrega === 'DISTANCIA') && !podeUsar(loja, 'ENTREGA_POR_DISTANCIA')) {
          bloquear('ENTREGA_POR_DISTANCIA');
          avisos.add(AVISO_TAXA_FIXA);
          delete dados.faixasEntrega;
          delete dados.modoEntrega;
        }
        if (dados.usaMelhorEnvio === true && !podeUsar(loja, 'MELHOR_ENVIO')) {
          bloquear('MELHOR_ENVIO');
          delete dados.usaMelhorEnvio;
        }
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
