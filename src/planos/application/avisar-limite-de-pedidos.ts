import { logger } from '../../shared/logger/logger.js';
import { avisoDeLimiteDePedidos, planoEfetivo } from '../domain/assinatura.js';
import { intervaloDoMes, mesNoFuso } from '../domain/calendario.js';
import type { PlanosDeps } from './dependencias.js';
import { mensagemLimiteDePedidos } from './mensagens.js';

/**
 * Depois de cada venda (pedido PAGO ou CONFIRMADO): se a loja passou de 80% ou
 * chegou a 100% dos pedidos do mês, avisa uma vez no mês. Nunca bloqueia o
 * cliente. Falha aqui só vai para o log: a venda já aconteceu.
 */
export async function avisarLimiteDePedidos(
  deps: Pick<PlanosDeps, 'repo' | 'mensageiro' | 'linkDosPlanos'>,
  empreendedorId: string,
  agora: Date = new Date(),
): Promise<void> {
  try {
    const encontrada = await deps.repo.obterOuIniciarTeste(empreendedorId, agora);
    if (!encontrada) {
      return;
    }
    const { loja, assinatura } = encontrada;
    const { inicio, fim } = intervaloDoMes(agora, loja.fuso);
    const usados = await deps.repo.contarVendas(loja.empreendedorId, inicio, fim);
    const resultado = avisoDeLimiteDePedidos(assinatura, usados, mesNoFuso(agora, loja.fuso));
    if (!resultado.aviso) {
      return;
    }
    // Marca antes de enviar: um aviso perdido é melhor que o mesmo aviso repetido a cada pedido.
    await deps.repo.salvar(resultado.assinatura);
    logger.info({ empreendedorId: loja.empreendedorId, ...resultado.aviso }, '📈 aviso de limite de pedidos');
    await deps.mensageiro.enviarTexto(
      loja.telefone,
      mensagemLimiteDePedidos(resultado.aviso, planoEfetivo(assinatura), deps.linkDosPlanos),
    );
  } catch (erro) {
    logger.error({ err: erro, empreendedorId }, 'falha ao conferir o limite de pedidos do mês');
  }
}
