import { decidirPedido } from '../../orders/application/decidir-pedido.js';
import { OPCAO_ACEITAR, OPCAO_RECUSAR } from '../../orders/application/pedir-aceite-da-loja.js';
import { linhaDoCliente } from '../../orders/application/resumo-do-pedido.js';
import { andamentoDaOpcao, atualizarAndamento, pedirAndamentoDaLoja } from '../../orders/application/andamento-pedido.js';
import { mensagemAndamento } from '../../orders/application/avisos-cliente.js';
import type { ContatoEmpreendedores } from '../../orders/application/ports/avisos-empreendedor.js';
import type { OrdersRepository } from '../../orders/application/ports/orders.repository.js';
import {
  descreverPagamento,
  extrairAndamentoPedido,
  extrairDecisaoPedido,
  ROTULO_STATUS_PEDIDO,
  type AndamentoPedido,
  type DecisaoPedido,
  type Pedido,
} from '../../orders/domain/pedido.js';
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
      `A loja aceitou seu pedido ${pedido.codigoCurto}! 🎉 Ela já está preparando.\nPagamento: ${descreverPagamento(pedido)} — R$ ${pedido.valorTotal.toFixed(2)}.`,
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
  // Pago na entrega já está em preparo: a loja recebe a enquete de andamento agora (no PIX, ela vem com o pagamento).
  if (decidido.status === 'CONFIRMADO') {
    await pedirAndamentoDaLoja({ ...deps, mensageiro: mensageiroDa(whatsapp) }, decidido);
  }
}

function mensageiroDa(whatsapp: WhatsAppClient) {
  return {
    enviarTexto: (telefone: string, texto: string) => whatsapp.sendText(telefone, texto),
    enviarEnquete: (telefone: string, pergunta: string, opcoes: string[]) => whatsapp.sendPoll(telefone, pergunta, opcoes),
  };
}

/** Loja avisou que saiu/está pronto ou foi entregue/retirado: atualiza e avisa o cliente. */
async function aplicarAndamento(
  deps: DecisaoPedidoDeps,
  whatsapp: WhatsAppClient,
  telefoneLoja: string,
  pedido: Pedido,
  andamento: AndamentoPedido,
): Promise<void> {
  let atualizado: Pedido;
  try {
    atualizado = await atualizarAndamento(deps, pedido, andamento, telefoneLoja);
  } catch (erro) {
    if (erro instanceof DomainError) {
      await whatsapp.sendText(telefoneLoja, erro.message);
      return;
    }
    throw erro;
  }

  logger.info({ codigoCurto: pedido.codigoCurto, status: atualizado.status }, '🧾 loja atualizou o andamento');
  const cliente = deps.clientePedidos();
  const aviso = mensagemAndamento(atualizado);
  let clienteAvisado = false;
  if (cliente && atualizado.telefoneCliente && aviso) {
    await cliente.sendText(atualizado.telefoneCliente, aviso);
    clienteAvisado = true;
  }
  await whatsapp.sendText(
    telefoneLoja,
    `Pedido ${pedido.codigoCurto}: ${ROTULO_STATUS_PEDIDO[atualizado.status].toLowerCase()} ✅ ${clienteAvisado ? 'Cliente avisado.' : 'Não consegui avisar o cliente agora.'}`,
  );
}

/**
 * Resposta da loja em texto ("aceitar PED-XXXX"). Devolve true quando a
 * mensagem era uma decisão (e já foi tratada), false para seguir para a gestão.
 */
export async function tratarRespostaDaLojaEmTexto(
  deps: DecisaoPedidoDeps,
  whatsapp: WhatsAppClient,
  mensagem: MensagemRecebida,
): Promise<boolean> {
  const decisao = extrairDecisaoPedido(mensagem.corpo);
  const andamento = decisao ? null : extrairAndamentoPedido(mensagem.corpo);
  const codigoCurto = decisao?.codigoCurto ?? andamento?.codigoCurto;
  if (!codigoCurto) {
    return false;
  }
  const pedido = await deps.ordersRepo.buscarPorCodigo(codigoCurto);
  if (!pedido) {
    await whatsapp.sendText(mensagem.telefone, `Não encontrei o pedido ${codigoCurto}.`);
    return true;
  }
  if (decisao) {
    await aplicarDecisao(deps, whatsapp, mensagem.telefone, pedido, decisao.decisao);
  } else if (andamento) {
    await aplicarAndamento(deps, whatsapp, mensagem.telefone, pedido, andamento.andamento);
  }
  return true;
}

/** Votos nas enquetes da loja: Aceitar/Recusar e a de andamento (saiu/pronto, entregue/retirado). */
export function registrarVotosDaLoja(deps: DecisaoPedidoDeps, whatsapp: WhatsAppClient): void {
  whatsapp.onPollVote(async (voto) => {
    const pedido = await deps.ordersRepo.buscarPorEnquete(voto.enqueteId);
    const opcao = voto.opcoes[0];
    if (!pedido || !opcao || (await deps.idempotency.jaProcessado(ORIGEM_VOTO, voto.id))) {
      return;
    }
    if (voto.enqueteId === pedido.enqueteAceiteId && (opcao === OPCAO_ACEITAR || opcao === OPCAO_RECUSAR)) {
      await aplicarDecisao(deps, whatsapp, voto.telefone, pedido, opcao === OPCAO_ACEITAR ? 'ACEITAR' : 'RECUSAR');
    } else if (voto.enqueteId === pedido.enqueteAndamentoId) {
      const andamento = andamentoDaOpcao(pedido, opcao);
      if (!andamento) return;
      await aplicarAndamento(deps, whatsapp, voto.telefone, pedido, andamento);
    } else {
      return;
    }
    await deps.idempotency.marcarProcessado(ORIGEM_VOTO, voto.id);
  });
}
