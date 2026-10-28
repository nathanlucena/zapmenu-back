import { DomainError } from '../../shared/errors/domain-error.js';
import { logger } from '../../shared/logger/logger.js';
import {
  podeTransicionar,
  ROTULO_STATUS_PEDIDO,
  statusACaminho,
  STATUS_EM_ANDAMENTO,
  type AndamentoPedido,
  type Pedido,
  type Rastreio,
  type StatusPedido,
} from '../domain/pedido.js';
import { garantirDonoDaLoja } from './decidir-pedido.js';
import type { ContatoEmpreendedores, MensageiroEmpreendedor } from './ports/avisos-empreendedor.js';
import type { LojaParaPedidos } from './ports/loja-para-pedidos.js';
import type { OrdersRepository } from './ports/orders.repository.js';

/** Opção extra da enquete nas lojas de varejo, antes de sair/ficar pronto. */
export const OPCAO_SEPARADO = 'Separado';

/** Opções da enquete de andamento, na ordem em que a loja usa: primeiro a caminho, depois concluído. */
export function opcoesDeAndamento(pedido: Pick<Pedido, 'modalidade'>): { aCaminho: string; concluido: string } {
  switch (pedido.modalidade) {
    case 'ENTREGA':
      return { aCaminho: 'Saiu para entrega', concluido: 'Entregue' };
    case 'ENVIO':
    case 'MELHOR_ENVIO':
      return { aCaminho: 'Enviado', concluido: 'Entregue' };
    default:
      return { aCaminho: 'Pronto para retirar', concluido: 'Retirado' };
  }
}

export function andamentoDaOpcao(pedido: Pick<Pedido, 'modalidade'>, opcao: string): AndamentoPedido | undefined {
  const opcoes = opcoesDeAndamento(pedido);
  if (opcao === OPCAO_SEPARADO) return 'SEPARADO';
  if (opcao === opcoes.aCaminho) return 'A_CAMINHO';
  if (opcao === opcoes.concluido) return 'CONCLUIDO';
  return undefined;
}

export interface AndamentoDeps {
  ordersRepo: OrdersRepository;
  contatos: ContatoEmpreendedores;
}

/** Sem ela, a enquete é a de sempre (comida). */
export interface AndamentoComEnqueteDeps extends AndamentoDeps {
  mensageiro: MensageiroEmpreendedor;
  lojaParaPedidos?: LojaParaPedidos;
}

/**
 * Manda à loja a enquete de andamento do pedido (saiu/pronto e entregue/retirado;
 * no varejo, "Separado" antes). A mesma enquete serve para todos os passos:
 * trocar o voto avança o pedido.
 */
export async function pedirAndamentoDaLoja(deps: AndamentoComEnqueteDeps, pedido: Pedido): Promise<void> {
  const telefone = await deps.contatos.telefoneDe(pedido.empreendedorId);
  if (!telefone || !deps.mensageiro.enviarEnquete) {
    logger.warn({ pedidoId: pedido.id }, 'não foi possível enviar a enquete de andamento');
    return;
  }
  const opcoes = opcoesDeAndamento(pedido);
  const varejo = (await deps.lojaParaPedidos?.regrasDe(pedido.empreendedorId))?.segmento === 'VAREJO';
  const enqueteId = await deps.mensageiro.enviarEnquete(telefone, `Andamento do pedido ${pedido.codigoCurto}`, [
    ...(varejo ? [OPCAO_SEPARADO] : []),
    opcoes.aCaminho,
    opcoes.concluido,
  ]);
  if (enqueteId) {
    await deps.ordersRepo.atualizar(pedido.id, { enqueteAndamentoId: enqueteId });
  }
}

function statusDoAndamento(pedido: Pick<Pedido, 'modalidade'>, andamento: AndamentoPedido): StatusPedido {
  switch (andamento) {
    case 'A_CAMINHO':
      return statusACaminho(pedido.modalidade);
    case 'SEPARADO':
    case 'ENVIADO':
    case 'CONCLUIDO':
      return andamento;
  }
}

/**
 * A loja avisa que separou, que o pedido saiu/está pronto, que enviou (com
 * rastreio) ou que foi entregue/retirado. Só o dono da loja. Repetir o mesmo
 * aviso, ou dois avisos ao mesmo tempo, não muda nada nem avisa o cliente de novo.
 */
export async function atualizarAndamento(
  deps: AndamentoDeps,
  pedido: Pedido,
  andamento: AndamentoPedido,
  telefoneDaLoja: string,
  rastreio: Rastreio = {},
): Promise<Pedido> {
  await garantirDonoDaLoja(deps.contatos, pedido, telefoneDaLoja);
  const proximo = statusDoAndamento(pedido, andamento);
  if (pedido.status === proximo) {
    throw new DomainError(
      `O pedido ${pedido.codigoCurto} já está como "${ROTULO_STATUS_PEDIDO[proximo].toLowerCase()}".`,
      'ANDAMENTO_REPETIDO',
      'CONFLITO',
    );
  }
  if (!podeTransicionar(pedido.status, proximo)) {
    const motivo = STATUS_EM_ANDAMENTO.includes(pedido.status) || pedido.status === 'CONCLUIDO'
      ? `está "${ROTULO_STATUS_PEDIDO[pedido.status].toLowerCase()}"`
      : `ainda não foi pago ou aceito (${ROTULO_STATUS_PEDIDO[pedido.status].toLowerCase()})`;
    throw new DomainError(`O pedido ${pedido.codigoCurto} ${motivo}.`, 'TRANSICAO_INVALIDA', 'CONFLITO');
  }
  if (proximo === 'ENVIADO' && (pedido.modalidade ?? 'RETIRADA') === 'RETIRADA') {
    throw new DomainError(
      `O pedido ${pedido.codigoCurto} é para retirar na loja, não para enviar.`,
      'TRANSICAO_INVALIDA',
      'CONFLITO',
    );
  }
  const atualizado = await deps.ordersRepo.atualizarSeStatus(pedido.id, pedido.status, {
    status: proximo,
    ...(proximo === 'ENVIADO' && rastreio),
  });
  if (!atualizado) {
    throw new DomainError(`O pedido ${pedido.codigoCurto} acabou de ser atualizado.`, 'ANDAMENTO_REPETIDO', 'CONFLITO');
  }
  return atualizado;
}

/** Pedidos em andamento há mais de `horas` são concluídos sozinhos, para nada ficar "a caminho" para sempre. */
export async function concluirPedidosAntigos(
  repositorio: OrdersRepository,
  horas: number,
  agora: Date = new Date(),
): Promise<Pedido[]> {
  const antigos = await repositorio.listarEmAndamentoAntesDe(new Date(agora.getTime() - horas * 3_600_000));
  const concluidos: Pedido[] = [];
  for (const pedido of antigos) {
    concluidos.push(await repositorio.atualizar(pedido.id, { status: 'CONCLUIDO' }));
  }
  return concluidos;
}
