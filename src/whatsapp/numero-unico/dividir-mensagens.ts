import { extrairCodigoPedido, extrairDecisaoPedido } from '../../orders/domain/pedido.js';
import type { ManipuladorMensagem, WhatsAppClient } from '../whatsapp-client.interface.js';

export interface ClientesDivididos {
  gestao: WhatsAppClient;
  pedidos: WhatsAppClient;
}

function comFiltro(client: WhatsAppClient, aceita: (texto: string) => boolean, recebeVotos: boolean): WhatsAppClient {
  return {
    sendText: (telefone, texto) => client.sendText(telefone, texto),
    sendImage: (telefone, imagem, legenda) => client.sendImage(telefone, imagem, legenda),
    sendPoll: (telefone, pergunta, opcoes) => client.sendPoll(telefone, pergunta, opcoes),
    onMessage(manipulador: ManipuladorMensagem) {
      client.onMessage((mensagem) => (aceita(mensagem.corpo) ? manipulador(mensagem) : undefined));
    },
    onPollVote(manipulador) {
      if (recebeVotos) {
        client.onPollVote(manipulador);
      }
    },
  };
}

/**
 * Para testar gestão e pedidos com um só número: mensagens de cliente com
 * código de pedido (PED-XXXX) vão para o fluxo de pedidos; o resto, inclusive
 * a resposta da loja ("aceitar PED-XXXX") e os votos da enquete, vai para a gestão.
 */
export function dividirMensagens(client: WhatsAppClient): ClientesDivididos {
  const ehDoCliente = (texto: string) => extrairCodigoPedido(texto) !== null && extrairDecisaoPedido(texto) === null;
  return {
    gestao: comFiltro(client, (texto) => !ehDoCliente(texto), true),
    pedidos: comFiltro(client, ehDoCliente, false),
  };
}
