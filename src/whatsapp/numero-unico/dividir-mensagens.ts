import { extrairAndamentoPedido, extrairCodigoPedido, extrairDecisaoPedido } from '../../orders/domain/pedido.js';
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
    sendDocument: async (telefone, dados, nome, mimetype, legenda) => client.sendDocument?.(telefone, dados, nome, mimetype, legenda),
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
 * as respostas da loja ("aceitar PED-XXXX", "saiu PED-XXXX") e os votos das enquetes, vai para a gestão.
 */
export function dividirMensagens(client: WhatsAppClient): ClientesDivididos {
  const ehDaLoja = (texto: string) => extrairDecisaoPedido(texto) !== null || extrairAndamentoPedido(texto) !== null;
  const ehDoCliente = (texto: string) => extrairCodigoPedido(texto) !== null && !ehDaLoja(texto);
  return {
    gestao: comFiltro(client, (texto) => !ehDoCliente(texto), true),
    pedidos: comFiltro(client, ehDoCliente, false),
  };
}
