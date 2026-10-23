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
import type { OrdersRepository } from './ports/orders.repository.js';

/** Opções da enquete de andamento, na ordem em que a loja usa: primeiro a caminho, depois concluído. */
export function opcoesDeAndamento(pedido: Pick<Pedido, 'modalidade'>): { aCaminho: string; concluido: string } {
  return pedido.modalidade === 'ENTREGA'
    ? { aCaminho: 'Saiu para entrega', concluido: 'Entregue' }
    : { aCaminho: 'Pronto para retirar', concluido: 'Retirado' };
}

export function andamentoDaOpcao(pedido: Pick<Pedido, 'modalidade'>, opcao: string): AndamentoPedido | undefined {
  const opcoes = opcoesDeAndamento(pedido);
  if (opcao === opcoes.aCaminho) return 'A_CAMINHO';
  if (opcao === opcoes.concluido) return 'CONCLUIDO';
  return undefined;
}

export interface AndamentoDeps {
  ordersRepo: OrdersRepository;
  contatos: ContatoEmpreendedores;
}

/**
 * Manda à loja a enquete de andamento do pedido (saiu/pronto e entregue/retirado).
 * A mesma enquete serve para os dois passos: trocar o voto avança o pedido.
 */
export async function pedirAndamentoDaLoja(
  deps: AndamentoDeps & { mensageiro: MensageiroEmpreendedor },
  pedido: Pedido,
): Promise<void> {
  const telefone = await deps.contatos.telefoneDe(pedido.empreendedorId);
  if (!telefone || !deps.mensageiro.enviarEnquete) {
    logger.warn({ pedidoId: pedido.id }, 'não foi possível enviar a enquete de andamento');
    return;
  }
  const opcoes = opcoesDeAndamento(pedido);
  const enqueteId = await deps.mensageiro.enviarEnquete(telefone, `Andamento do pedido ${pedido.codigoCurto}`, [
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
  if (proximo === 'ENVIADO' && pedido.modalidade !== 'ENTREGA') {
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
