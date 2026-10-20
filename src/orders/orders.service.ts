import { DomainError } from '../shared/errors/domain-error.js';
import { gerarCodigoPedido } from '../shared/ids/short-id.js';
import type { OrdersRepository } from './orders.repository.js';
import type { CarrinhoInput, ItemPedidoInput, Pedido, StatusPedido } from './orders.types.js';

const TRANSICOES_PERMITIDAS: Record<StatusPedido, StatusPedido[]> = {
  AGUARDANDO_CONFIRMACAO: ['AGUARDANDO_PAGAMENTO', 'EXPIRADO', 'CANCELADO'],
  AGUARDANDO_PAGAMENTO: ['PAGO', 'EXPIRADO', 'CANCELADO'],
  PAGO: [],
  EXPIRADO: [],
  CANCELADO: [],
};

export function podeTransicionar(atual: StatusPedido, proximo: StatusPedido): boolean {
  return TRANSICOES_PERMITIDAS[atual].includes(proximo);
}

const REGEX_CODIGO_PEDIDO = /PED-[A-Z0-9]{4}/i;

export function extrairCodigoPedido(texto: string): string | null {
  const match = texto.match(REGEX_CODIGO_PEDIDO);
  return match ? match[0].toUpperCase() : null;
}

export function calcularValorTotal(itens: ItemPedidoInput[]): number {
  return itens.reduce((total, item) => total + item.precoUnitario * item.quantidade, 0);
}

export function validarCarrinho(carrinho: CarrinhoInput): string[] {
  const erros: string[] = [];

  if (carrinho.itens.length === 0) {
    erros.push('O carrinho precisa de ao menos um item.');
  }
  for (const item of carrinho.itens) {
    if (item.quantidade <= 0) {
      erros.push(`Quantidade inválida para o item ${item.itemCardapioId}.`);
    }
    if (item.precoUnitario < 0) {
      erros.push(`Preço unitário inválido para o item ${item.itemCardapioId}.`);
    }
  }

  return erros;
}

export function estaExpirado(pedido: Pick<Pedido, 'status' | 'expiraEm'>, agora: Date): boolean {
  return pedido.status === 'AGUARDANDO_CONFIRMACAO' && agora > pedido.expiraEm;
}

async function gerarCodigoUnico(repositorio: OrdersRepository): Promise<string> {
  const MAX_TENTATIVAS = 5;
  for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
    const codigo = gerarCodigoPedido();
    if (!(await repositorio.codigoJaExiste(codigo))) {
      return codigo;
    }
  }
  throw new DomainError('Não foi possível gerar um código de pedido único.', 'CODIGO_PEDIDO_INDISPONIVEL');
}

export async function criarPedido(
  repositorio: OrdersRepository,
  carrinho: CarrinhoInput,
  ttlMinutos: number,
  agora: Date = new Date(),
): Promise<Pedido> {
  const erros = validarCarrinho(carrinho);
  if (erros.length > 0) {
    throw new DomainError(erros.join(' '), 'CARRINHO_INVALIDO');
  }

  const codigoCurto = await gerarCodigoUnico(repositorio);
  const expiraEm = new Date(agora.getTime() + ttlMinutos * 60_000);

  return repositorio.criar({
    codigoCurto,
    empreendedorId: carrinho.empreendedorId,
    status: 'AGUARDANDO_CONFIRMACAO',
    valorTotal: calcularValorTotal(carrinho.itens),
    itens: carrinho.itens,
    expiraEm,
    criadoEm: agora,
  });
}

export async function confirmarRecebimentoCliente(
  repositorio: OrdersRepository,
  codigoCurto: string,
  telefoneCliente: string,
  agora: Date = new Date(),
): Promise<Pedido> {
  const pedido = await repositorio.buscarPorCodigo(codigoCurto);
  if (!pedido) {
    throw new DomainError(`Pedido ${codigoCurto} não encontrado.`, 'PEDIDO_NAO_ENCONTRADO');
  }
  if (estaExpirado(pedido, agora)) {
    throw new DomainError(`Pedido ${codigoCurto} expirou.`, 'PEDIDO_EXPIRADO');
  }
  if (!podeTransicionar(pedido.status, 'AGUARDANDO_PAGAMENTO')) {
    throw new DomainError(
      `Pedido ${codigoCurto} está em status ${pedido.status} e não pode ser confirmado.`,
      'TRANSICAO_INVALIDA',
    );
  }

  return repositorio.atualizar(pedido.id, {
    status: 'AGUARDANDO_PAGAMENTO',
    telefoneCliente,
  });
}

export async function confirmarPagamento(
  repositorio: OrdersRepository,
  pedidoId: string,
  pedidoAtual: Pick<Pedido, 'status'>,
  agora: Date = new Date(),
): Promise<Pedido> {
  if (!podeTransicionar(pedidoAtual.status, 'PAGO')) {
    throw new DomainError(
      `Pedido não pode ser marcado como pago a partir do status ${pedidoAtual.status}.`,
      'TRANSICAO_INVALIDA',
    );
  }

  return repositorio.atualizar(pedidoId, { status: 'PAGO', confirmadoEm: agora });
}

export async function expirarPedidosPendentes(
  repositorio: OrdersRepository,
  agora: Date = new Date(),
): Promise<Pedido[]> {
  const pendentes = await repositorio.listarExpirados(agora);
  const expirados: Pedido[] = [];

  for (const pedido of pendentes) {
    if (estaExpirado(pedido, agora) && podeTransicionar(pedido.status, 'EXPIRADO')) {
      expirados.push(await repositorio.atualizar(pedido.id, { status: 'EXPIRADO' }));
    }
  }

  return expirados;
}
