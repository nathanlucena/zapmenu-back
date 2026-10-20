import { DomainError } from '../../shared/errors/domain-error.js';
import { gerarCodigoPedido } from '../../shared/ids/short-id.js';
import { calcularValorTotal, validarCarrinho, type CarrinhoInput, type Pedido } from '../domain/pedido.js';
import type { CardapioDePrecos, ItemCarrinho } from './ports/cardapio-de-precos.js';
import type { OrdersRepository } from './ports/orders.repository.js';

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

export interface CriarPedidoDoCarrinhoDeps {
  ordersRepo: OrdersRepository;
  cardapioDePrecos: CardapioDePrecos;
  pedidoTtlMinutos: number;
}

/** Carrinho do app do cliente: os preços são recalculados pelo cardápio antes de criar o pedido. */
export async function criarPedidoDoCarrinho(
  deps: CriarPedidoDoCarrinhoDeps,
  carrinho: { empreendedorId: string; itens: ItemCarrinho[] },
  agora: Date = new Date(),
): Promise<Pedido> {
  const itens = await deps.cardapioDePrecos.precificar(carrinho.empreendedorId, carrinho.itens);
  return criarPedido(deps.ordersRepo, { empreendedorId: carrinho.empreendedorId, itens }, deps.pedidoTtlMinutos, agora);
}
