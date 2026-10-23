import { decidirPedido } from '../../orders/application/decidir-pedido.js';
import { OPCAO_ACEITAR, OPCAO_RECUSAR } from '../../orders/application/pedir-aceite-da-loja.js';
import { linhaDoCliente } from '../../orders/application/resumo-do-pedido.js';
import {
  andamentoDaOpcao,
  atualizarAndamento,
  pedirAndamentoDaLoja,
} from '../../orders/application/andamento-pedido.js';
import { mensagemAndamento } from '../../orders/application/avisos-cliente.js';
import type { ContatoEmpreendedores } from '../../orders/application/ports/avisos-empreendedor.js';
import type { LojaParaPedidos } from '../../orders/application/ports/loja-para-pedidos.js';
import type { OrdersRepository } from '../../orders/application/ports/orders.repository.js';
import {
  descreverPagamento,
  extrairAndamentoPedido,
  extrairDecisaoPedido,
  ROTULO_STATUS_PEDIDO,
  type AndamentoPedido,
  type Rastreio,
  type DecisaoPedido,
  type Pedido,
} from '../../orders/domain/pedido.js';
import type { CobrancaGerada, GeradorCobranca } from '../../payments/application/gerar-cobranca.js';
import { DomainError } from '../../shared/errors/domain-error.js';
import type { IdempotencyRepository } from '../../shared/idempotency/idempotency.repository.js';
import { logger } from '../../shared/logger/logger.js';
import { enviarPix } from '../orders-session/orders-inbound.router.js';
import type { MensagemRecebida, VotoRecebido, WhatsAppClient } from '../whatsapp-client.interface.js';
import { criarAvisoDeFalha } from '../falhas.js';

const ORIGEM_VOTO = 'whatsapp_voto_aceite';

export interface DecisaoPedidoDeps {
  ordersRepo: OrdersRepository;
  contatos: ContatoEmpreendedores;
  geradorCobranca: GeradorCobranca;
  idempotency: IdempotencyRepository;
  /** Sessão que fala com os clientes; pode ainda não estar conectada. */
  clientePedidos: () => WhatsAppClient | undefined;
  /** Para saber o segmento da loja (varejo tem "Separado" na enquete de andamento). */
  lojaParaPedidos?: LojaParaPedidos;
}

/** Como foi o aviso ao cliente: avisado, não deu para avisar, ou (aceite com PIX) o PIX não saiu. */
type AvisoAoCliente = 'AVISADO' | 'NAO_AVISADO' | 'PIX_FALHOU';

async function enviarComSeguranca(acao: () => Promise<void>, codigoCurto: string): Promise<boolean> {
  try {
    await acao();
    return true;
  } catch (erro) {
    logger.error({ err: erro, codigoCurto }, 'falha ao avisar o cliente no WhatsApp');
    return false;
  }
}

async function avisarCliente(deps: DecisaoPedidoDeps, pedido: Pedido, decisao: DecisaoPedido): Promise<AvisoAoCliente> {
  // O PIX é gerado antes de qualquer aviso: se falhar, o pedido fica para o job tentar de novo.
  let cobranca: CobrancaGerada | undefined;
  if (decisao === 'ACEITAR' && pedido.status === 'AGUARDANDO_PAGAMENTO') {
    try {
      cobranca = await deps.geradorCobranca.gerarCobranca(pedido);
    } catch (erro) {
      logger.error(
        { err: erro, codigoCurto: pedido.codigoCurto },
        'falha ao gerar o PIX no aceite; vai tentar de novo',
      );
      await avisarAoCliente(deps, pedido, (cliente, telefone) =>
        cliente.sendText(
          telefone,
          `A loja aceitou seu pedido ${pedido.codigoCurto}! 🎉 O PIX está demorando um pouco: mando aqui em instantes.`,
        ),
      );
      return 'PIX_FALHOU';
    }
  }

  const avisado = await avisarAoCliente(deps, pedido, async (cliente, telefone) => {
    if (decisao === 'ACEITAR' && pedido.status === 'CONFIRMADO') {
      await cliente.sendText(
        telefone,
        `A loja aceitou seu pedido ${pedido.codigoCurto}! 🎉 Ela já está preparando.\nPagamento: ${descreverPagamento(pedido)} — R$ ${pedido.valorTotal.toFixed(2)}.`,
      );
    } else if (decisao === 'ACEITAR') {
      await cliente.sendText(telefone, `A loja aceitou seu pedido ${pedido.codigoCurto}! 🎉 Pague com o PIX abaixo:`);
      // Reusa a cobrança já gerada acima, sem pedir de novo ao Mercado Pago.
      const jaGerada = cobranca;
      await enviarPix(
        cliente,
        jaGerada ? { gerarCobranca: async () => jaGerada } : deps.geradorCobranca,
        pedido,
        telefone,
      );
    } else {
      await cliente.sendText(
        telefone,
        `A loja não pôde aceitar seu pedido ${pedido.codigoCurto}. 😕 Se quiser, faça um novo pedido pelo cardápio.`,
      );
    }
  });
  return avisado ? 'AVISADO' : 'NAO_AVISADO';
}

/** Manda pela sessão de pedidos; falha de envio não interrompe o resto (o pedido já está gravado). */
async function avisarAoCliente(
  deps: DecisaoPedidoDeps,
  pedido: Pedido,
  enviar: (cliente: WhatsAppClient, telefone: string) => Promise<void>,
): Promise<boolean> {
  const cliente = deps.clientePedidos();
  const telefone = pedido.telefoneCliente;
  if (!cliente || !telefone) {
    logger.warn(
      { codigoCurto: pedido.codigoCurto },
      'sessão de pedidos indisponível, cliente não foi avisado da decisão',
    );
    return false;
  }
  return enviarComSeguranca(() => enviar(cliente, telefone), pedido.codigoCurto);
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
  const aviso = await avisarCliente(deps, decidido, decisao);
  const clienteAvisado = aviso === 'AVISADO';
  let resultado: string;
  if (aviso === 'PIX_FALHOU') {
    resultado = `Pedido ${pedido.codigoCurto} aceito ✅, mas o PIX não saiu agora (o pagamento está instável). Vou tentar de novo e mando para o cliente assim que sair.`;
  } else if (decisao === 'RECUSAR') {
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
    enviarEnquete: (telefone: string, pergunta: string, opcoes: string[]) =>
      whatsapp.sendPoll(telefone, pergunta, opcoes),
  };
}

/** Loja avisou que separou, saiu/está pronto, enviou ou foi entregue/retirado: atualiza e avisa o cliente. */
async function aplicarAndamento(
  deps: DecisaoPedidoDeps,
  whatsapp: WhatsAppClient,
  telefoneLoja: string,
  pedido: Pedido,
  andamento: AndamentoPedido,
  rastreio?: Rastreio,
): Promise<void> {
  let atualizado: Pedido;
  try {
    atualizado = await atualizarAndamento(deps, pedido, andamento, telefoneLoja, rastreio);
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
    await aplicarAndamento(deps, whatsapp, mensagem.telefone, pedido, andamento.andamento, andamento.rastreio);
  }
  return true;
}

/** Votos nas enquetes da loja: Aceitar/Recusar e a de andamento (saiu/pronto, entregue/retirado). */
export function registrarVotosDaLoja(deps: DecisaoPedidoDeps, whatsapp: WhatsAppClient): void {
  const avisarFalha = criarAvisoDeFalha('voto da loja');
  whatsapp.onPollVote(async (voto) => {
    try {
      await tratarVoto(deps, whatsapp, voto);
    } catch (erro) {
      await avisarFalha(whatsapp, voto.telefone, voto.id, erro, 'Não consegui registrar seu voto. ');
    }
  });
}

async function tratarVoto(deps: DecisaoPedidoDeps, whatsapp: WhatsAppClient, voto: VotoRecebido): Promise<void> {
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
}
