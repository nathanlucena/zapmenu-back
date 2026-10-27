import { logger } from '../../shared/logger/logger.js';
import { verificarAssinatura, type EventoDaVerificacao } from '../domain/assinatura.js';
import type { PlanosDeps } from './dependencias.js';
import {
  mensagemCanceladaEncerrada,
  mensagemCobrancaPendente,
  mensagemFimDoTeste,
  mensagemSuspensaPorFaltaDePagamento,
  mensagemTesteEncerrado,
} from './mensagens.js';

function mensagemDo(evento: EventoDaVerificacao, linkDosPlanos?: string): string {
  switch (evento.tipo) {
    case 'AVISO_FIM_DO_TESTE':
      return mensagemFimDoTeste(evento.diasRestantes, linkDosPlanos);
    case 'TESTE_ENCERRADO':
      return mensagemTesteEncerrado(linkDosPlanos);
    case 'COBRANCA_PENDENTE':
      return mensagemCobrancaPendente(evento.diasParaSuspender);
    case 'SUSPENSA_POR_FALTA_DE_PAGAMENTO':
      return mensagemSuspensaPorFaltaDePagamento();
    case 'CANCELADA_ENCERRADA':
      return mensagemCanceladaEncerrada();
  }
}

/**
 * Rodada do job diário: avisos do teste (dias 10 e 13), suspensão no fim do
 * teste e após 5 dias de cobrança recusada, aviso diário da pendente. Pode
 * rodar várias vezes no dia: cada aviso sai uma vez só. Uma loja com erro não para as outras.
 */
export async function verificarAssinaturas(
  deps: Pick<PlanosDeps, 'repo' | 'mensageiro' | 'linkDosPlanos'>,
  agora: Date = new Date(),
): Promise<void> {
  for (const { loja, assinatura } of await deps.repo.listarParaVerificar()) {
    try {
      const verificada = verificarAssinatura(assinatura, agora, loja.fuso);
      if (verificada.eventos.length === 0) {
        continue;
      }
      // Grava antes de avisar: se o envio falhar, o aviso não se repete a cada rodada.
      await deps.repo.salvar(verificada.assinatura);
      for (const evento of verificada.eventos) {
        logger.info({ empreendedorId: loja.empreendedorId, evento: evento.tipo }, '🗓️ assinatura verificada');
        await deps.mensageiro.enviarTexto(loja.telefone, mensagemDo(evento, deps.linkDosPlanos));
      }
    } catch (erro) {
      logger.error({ err: erro, empreendedorId: loja.empreendedorId }, 'falha ao verificar a assinatura');
    }
  }
}
