import { extrairCodigoPedido } from '../../orders/domain/pedido.js';
import type { ManipuladorMensagem, WhatsAppClient } from '../whatsapp-client.interface.js';

export interface ClientesDivididos {
  gestao: WhatsAppClient;
  pedidos: WhatsAppClient;
}

function comFiltro(client: WhatsAppClient, aceita: (texto: string) => boolean): WhatsAppClient {
  return {
    sendText: (telefone, texto) => client.sendText(telefone, texto),
    sendImage: (telefone, imagem, legenda) => client.sendImage(telefone, imagem, legenda),
    onMessage(manipulador: ManipuladorMensagem) {
      client.onMessage((mensagem) => (aceita(mensagem.corpo) ? manipulador(mensagem) : undefined));
    },
  };
}

/**
 * Para testar gestão e pedidos com um só número: mensagens com código de
 * pedido (PED-XXXX) vão para o fluxo de pedidos, e todas as outras para a gestão.
 */
export function dividirMensagens(client: WhatsAppClient): ClientesDivididos {
  const temCodigo = (texto: string) => extrairCodigoPedido(texto) !== null;
  return {
    gestao: comFiltro(client, (texto) => !temCodigo(texto)),
    pedidos: comFiltro(client, temCodigo),
  };
}
