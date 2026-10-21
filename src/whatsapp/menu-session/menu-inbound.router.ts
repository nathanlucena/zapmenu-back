import { processarMensagemGestao, type GestaoDeps } from '../../menu/gestao/gestao.service.js';
import type { IdempotencyRepository } from '../../shared/idempotency/idempotency.repository.js';
import { logger } from '../../shared/logger/logger.js';
import type { WhatsAppClient } from '../whatsapp-client.interface.js';

const ORIGEM_IDEMPOTENCIA = 'whatsapp_menu';

export interface MenuInboundRouterDeps extends GestaoDeps {
  whatsapp: WhatsAppClient;
  idempotency: IdempotencyRepository;
}

/**
 * Mensagens do mesmo telefone são processadas uma de cada vez: cada uma lê o
 * estado da conversa, espera a IA e grava o estado de volta — em paralelo, a
 * última a terminar apagaria o que a outra fez.
 */
function criarFilaPorTelefone() {
  const filas = new Map<string, Promise<void>>();
  return (telefone: string, tarefa: () => Promise<void>): Promise<void> => {
    const anterior = filas.get(telefone) ?? Promise.resolve();
    const atual = anterior.then(tarefa, tarefa);
    const registrada = atual.catch(() => undefined);
    filas.set(telefone, registrada);
    void registrada.then(() => {
      if (filas.get(telefone) === registrada) {
        filas.delete(telefone);
      }
    });
    return atual;
  };
}

export function registrarMenuInboundRouter(deps: MenuInboundRouterDeps): void {
  const enfileirar = criarFilaPorTelefone();

  deps.whatsapp.onMessage((mensagem) => enfileirar(mensagem.telefone, async () => {
    if (await deps.idempotency.jaProcessado(ORIGEM_IDEMPOTENCIA, mensagem.id)) {
      logger.info({ mensagemId: mensagem.id }, 'mensagem de gestão já processada (reentrega), ignorando');
      return;
    }

    const respostas = await processarMensagemGestao(
      { telefone: mensagem.telefone, texto: mensagem.corpo, imagemUrl: mensagem.imagemUrl },
      deps,
    );
    for (const resposta of respostas) {
      await deps.whatsapp.sendText(mensagem.telefone, resposta);
    }
    await deps.idempotency.marcarProcessado(ORIGEM_IDEMPOTENCIA, mensagem.id);
  }));
}
