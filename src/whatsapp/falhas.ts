import { IntegracaoError } from '../shared/errors/integracao-error.js';
import { logger } from '../shared/logger/logger.js';
import type { WhatsAppClient } from './whatsapp-client.interface.js';

/** Quantos ids de mensagem lembrar para não pedir desculpas duas vezes pela mesma mensagem. */
const MAX_LEMBRADOS = 500;

/** O que dizer quando algo inesperado falhou: depende de quem falhou. */
export function mensagemDeFalha(erro: unknown): string {
  if (erro instanceof IntegracaoError && erro.servico === 'mercado_pago') {
    return 'O sistema de pagamento está instável agora 😕 Tente de novo em alguns minutos.';
  }
  if (erro instanceof IntegracaoError) {
    return 'A busca de endereço está instável agora 😕 Tente de novo em alguns minutos.';
  }
  return 'Tive um problema agora 😕 Tente de novo em instantes.';
}

/**
 * Rede de segurança dos routers: loga o erro e responde a pessoa, uma vez por
 * mensagem (o WhatsApp pode reentregar a mesma). Quem chama não marca a
 * mensagem como processada, para a reentrega tentar de novo.
 */
export function criarAvisoDeFalha(contexto: string) {
  const avisadas = new Set<string>();
  return async (whatsapp: WhatsAppClient, telefone: string, mensagemId: string, erro: unknown, prefixo = '') => {
    logger.error({ err: erro, mensagemId, contexto }, `💥 falha ao tratar ${contexto}`);
    if (avisadas.has(mensagemId)) {
      return;
    }
    avisadas.add(mensagemId);
    if (avisadas.size > MAX_LEMBRADOS) {
      avisadas.delete(avisadas.values().next().value!);
    }
    try {
      await whatsapp.sendText(telefone, `${prefixo}${mensagemDeFalha(erro)}`);
    } catch (erroAoAvisar) {
      logger.error({ err: erroAoAvisar, mensagemId }, 'não foi possível avisar a falha no WhatsApp');
    }
  };
}
