import type { WhatsAppClient } from '../whatsapp-client.interface.js';

export const ROTULO_GESTAO = '🧑‍🍳 *Gestão*';
export const ROTULO_PEDIDOS = '🛍️ *Pedidos*';

/**
 * Coloca uma linha com o nome do bot antes de cada mensagem enviada. Usado só
 * no modo autoteste, quando gestão e pedidos podem falar pelo mesmo número.
 */
export function identificarBot(client: WhatsAppClient, rotulo: string): WhatsAppClient {
  return {
    sendText: (telefone, texto) => client.sendText(telefone, `${rotulo}\n${texto}`),
    sendImage: (telefone, imagem, legenda) =>
      client.sendImage(telefone, imagem, legenda ? `${rotulo}\n${legenda}` : rotulo),
    // A enquete vem logo depois de um texto já identificado; o nome dela fica limpo.
    sendPoll: (telefone, pergunta, opcoes) => client.sendPoll(telefone, pergunta, opcoes),
    sendDocument: async (telefone, dados, nome, mimetype, legenda) =>
      client.sendDocument?.(telefone, dados, nome, mimetype, legenda ? `${rotulo}\n${legenda}` : rotulo),
    onMessage: (manipulador) => client.onMessage(manipulador),
    onPollVote: (manipulador) => client.onPollVote(manipulador),
  };
}
