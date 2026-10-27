import { DomainError } from '../../shared/errors/domain-error.js';
import { logger } from '../../shared/logger/logger.js';
import type { CotadorDeFrete, ItemParaFrete } from '../../orders/application/ports/cotador-de-frete.js';
import { medidasDoProduto, produtoDoPacote, type ProdutoDoPacote } from '../domain/pacote.js';
import type { MelhorEnvioDeps } from './dependencias.js';
import { tokenValido } from './conexao.js';

/** Falha seguida há mais que isso: a loja é avisada (uma vez). */
const AVISAR_FALHA_DEPOIS_MS = 30 * 60_000;

export const FRETE_INDISPONIVEL = 'Não conseguimos calcular o frete agora.';

/** O pacote do carrinho com as medidas de cada produto (ou da categoria, ou o padrão). */
export async function produtosDoPacote(deps: Pick<MelhorEnvioDeps, 'contas'>, itens: ItemParaFrete[]): Promise<ProdutoDoPacote[]> {
  const medidas = await deps.contas.medidasDosItens([...new Set(itens.map((item) => item.itemCardapioId))]);
  return itens.map((item) => {
    const doItem = medidas.get(item.itemCardapioId);
    return produtoDoPacote(item.itemCardapioId, medidasDoProduto(doItem?.produto ?? {}, doItem?.categoria), item.precoUnitario, item.quantidade);
  });
}

/**
 * Cotação no Melhor Envio com a conta da loja: tenta de novo uma vez e, se
 * ainda falhar, lança FRETE_INDISPONIVEL (o app mostra só o envio próprio, se
 * houver). Falha que passa de 30 min é avisada ao lojista uma vez.
 */
export function criarCotadorMelhorEnvio(deps: MelhorEnvioDeps): CotadorDeFrete {
  return {
    async cotar(empreendedorId, pedido) {
      const agora = deps.relogio?.() ?? new Date();
      const conta = await deps.contas.daLoja(empreendedorId);
      if (!conta) {
        throw new DomainError('Loja não encontrada.', 'LOJA_NAO_ENCONTRADA', 'NAO_ENCONTRADO');
      }
      const produtos = await produtosDoPacote(deps, pedido.itens);
      let ultimoErro: unknown;
      for (let tentativa = 0; tentativa < 2; tentativa++) {
        try {
          const token = await tokenValido(deps, empreendedorId);
          if (!token) {
            throw new DomainError('Esta loja não envia por transportadora.', 'ENVIO_INDISPONIVEL');
          }
          const servicos = await deps.gateway.cotar(token.accessToken, { cepOrigem: pedido.cepOrigem, cepDestino: pedido.cepDestino, produtos });
          if (conta.falhaDesde) await deps.contas.limparFalha(conta.lojaId);
          return servicos;
        } catch (erro) {
          if (erro instanceof DomainError) throw erro;
          ultimoErro = erro;
        }
      }
      logger.warn({ err: ultimoErro, lojaId: conta.lojaId }, 'cotação do Melhor Envio falhou duas vezes');
      await registrarFalha(deps, conta, agora);
      throw new DomainError(FRETE_INDISPONIVEL, 'FRETE_INDISPONIVEL', 'INDISPONIVEL');
    },
  };
}

async function registrarFalha(
  deps: MelhorEnvioDeps,
  conta: { lojaId: string; telefone: string; falhaDesde?: Date; avisoFalhaEm?: Date },
  agora: Date,
): Promise<void> {
  if (!conta.falhaDesde) {
    await deps.contas.registrarFalha(conta.lojaId, agora);
    return;
  }
  const jaAvisou = conta.avisoFalhaEm && conta.avisoFalhaEm >= conta.falhaDesde;
  if (!jaAvisou && agora.getTime() - conta.falhaDesde.getTime() >= AVISAR_FALHA_DEPOIS_MS) {
    await deps.contas.registrarAvisoDeFalha(conta.lojaId, agora);
    await deps.mensageiro
      .enviarTexto(
        conta.telefone,
        '⚠️ O Melhor Envio está sem responder há mais de 30 minutos: os clientes não conseguem ver o frete por transportadora agora. Se a sua conta estiver com problema, mande *conectar melhor envio* para conectar de novo.',
      )
      .catch(() => undefined);
  }
}
