import { decidirPedido } from '../../orders/application/decidir-pedido.js';
import { OPCAO_ACEITAR, OPCAO_RECUSAR } from '../../orders/application/pedir-aceite-da-loja.js';
import { linhaDoCliente } from '../../orders/application/resumo-do-pedido.js';
import type { ContatoEmpreendedores } from '../../orders/application/ports/avisos-empreendedor.js';
import type { OrdersRepository } from '../../orders/application/ports/orders.repository.js';
import { descreverPagamento, extrairDecisaoPedido, type DecisaoPedido, type Pedido } from '../../orders/domain/pedido.js';
import type { GeradorCobranca } from '../../payments/application/gerar-cobranca.js';
import { DomainError } from '../../shared/errors/domain-error.js';
import type { IdempotencyRepository } from '../../shared/idempotency/idempotency.repository.js';
import { logger } from '../../shared/logger/logger.js';
import { enviarPix } from '../orders-session/orders-inbound.router.js';
import type { MensagemRecebida, WhatsAppClient } from '../whatsapp-client.interface.js';

const ORIGEM_VOTO = 'whatsapp_voto_aceite';

export interface DecisaoPedidoDeps {
  ordersRepo: OrdersRepository;
  contatos: ContatoEmpreendedores;
  geradorCobranca: GeradorCobranca;
  idempotency: IdempotencyRepository;
  /** Sessão que fala com os clientes; pode ainda não estar conectada. */
  clientePedidos: () => WhatsAppClient | undefined;
}

async function avisarCliente(deps: DecisaoPedidoDeps, pedido: Pedido, decisao: DecisaoPedido): Promise<boolean> {
  const cliente = deps.clientePedidos();
  if (!cliente || !pedido.telefoneCliente) {
    logger.warn({ codigoCurto: pedido.codigoCurto }, 'sessão de pedidos indisponível, cliente não foi avisado da decisão');
    return false;
  }
  if (decisao === 'ACEITAR' && pedido.status === 'CONFIRMADO') {
    await cliente.sendText(
      pedido.telefoneCliente,
      `A loja aceitou seu pedido ${pedido.codigoCurto}! 🎉\nPagamento: ${descreverPagamento(pedido)} — R$ ${pedido.valorTotal.toFixed(2)}.`,
    );
  } else if (decisao === 'ACEITAR') {
    await cliente.sendText(pedido.telefoneCliente, `A loja aceitou seu pedido ${pedido.codigoCurto}! 🎉 Pague com o PIX abaixo:`);
    await enviarPix(cliente, deps.geradorCobranca, pedido, pedido.telefoneCliente);
  } else {
    await cliente.sendText(
      pedido.telefoneCliente,
      `A loja não pôde aceitar seu pedido ${pedido.codigoCurto}. 😕 Se quiser, faça um novo pedido pelo cardápio.`,
    );
  }
  return true;
}

/** Aplica a decisão da loja e responde para a loja e para o cliente. */
async function aplicarDecisao(
  deps: DecisaoPedidoDeps,
  whatsapp: WhatsAppClient,
  telefoneLoja: string,
  pedido: Pedido,
  decisao: DecisaoPedido,
): Promise<void> {
  let decidido: Pedido;
  try {
    decidido = await decidirPedido(deps, pedido, decisao, telefoneLoja);
  } catch (erro) {
    if (erro instanceof DomainError) {
      await whatsapp.sendText(telefoneLoja, erro.message);
      return;
    }
    throw erro;
  }

  logger.info({ codigoCurto: pedido.codigoCurto, decisao }, '🧾 loja respondeu o pedido');
  const clienteAvisado = await avisarCliente(deps, decidido, decisao);
  let resultado: string;
  if (decisao === 'RECUSAR') {
    resultado = `Pedido ${pedido.codigoCurto} recusado. ${clienteAvisado ? 'O cliente foi avisado.' : 'Não consegui avisar o cliente agora.'}`;
  } else if (decidido.status === 'CONFIRMADO') {
    const cliente = linhaDoCliente(decidido);
    resultado = `Pedido ${pedido.codigoCurto} aceito ✅ Pagamento: ${descreverPagamento(decidido)}. ${clienteAvisado ? 'O cliente foi avisado.' : 'Não consegui avisar o cliente agora.'}${cliente ? `\n${cliente}` : ''}`;
  } else {
    resultado = `Pedido ${pedido.codigoCurto} aceito ✅ ${clienteAvisado ? 'O PIX foi enviado ao cliente.' : 'Não consegui enviar o PIX ao cliente agora.'}`;
  }
  await whatsapp.sendText(telefoneLoja, resultado);
}

/**
 * Resposta da loja em texto ("aceitar PED-XXXX"). Devolve true quando a
 * mensagem era uma decisão (e já foi tratada), false para seguir para a gestão.
 */
export async function tratarDecisaoEmTexto(
  deps: DecisaoPedidoDeps,
  whatsapp: WhatsAppClient,
  mensagem: MensagemRecebida,
): Promise<boolean> {
  const decisao = extrairDecisaoPedido(mensagem.corpo);
  if (!decisao) {
    return false;
  }
  const pedido = await deps.ordersRepo.buscarPorCodigo(decisao.codigoCurto);
  if (!pedido) {
    await whatsapp.sendText(mensagem.telefone, `Não encontrei o pedido ${decisao.codigoCurto}.`);
    return true;
  }
  await aplicarDecisao(deps, whatsapp, mensagem.telefone, pedido, decisao.decisao);
  return true;
}

/** Votos na enquete Aceitar/Recusar enviada junto com o resumo do pedido. */
export function registrarVotosDeAceite(deps: DecisaoPedidoDeps, whatsapp: WhatsAppClient): void {
  whatsapp.onPollVote(async (voto) => {
    const pedido = await deps.ordersRepo.buscarPorEnquete(voto.enqueteId);
    const opcao = voto.opcoes[0];
    if (!pedido || (opcao !== OPCAO_ACEITAR && opcao !== OPCAO_RECUSAR)) {
      return;
    }
    if (await deps.idempotency.jaProcessado(ORIGEM_VOTO, voto.id)) {
      return;
    }
    await aplicarDecisao(deps, whatsapp, voto.telefone, pedido, opcao === OPCAO_ACEITAR ? 'ACEITAR' : 'RECUSAR');
    await deps.idempotency.marcarProcessado(ORIGEM_VOTO, voto.id);
  });
}
