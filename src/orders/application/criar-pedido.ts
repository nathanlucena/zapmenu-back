import { DomainError } from '../../shared/errors/domain-error.js';
import { gerarCodigoPedido } from '../../shared/ids/short-id.js';
import { lojaAberta } from '../domain/horario-loja.js';
import {
  calcularValorTotal,
  validarCarrinho,
  type CarrinhoInput,
  pagaNaEntrega,
  type DetalhesPedido,
  type FormaPagamento,
  type ModalidadePedido,
  type Pedido,
} from '../domain/pedido.js';
import { cotarEntrega } from './cotar-entrega.js';
import type { CardapioDePrecos, ItemCarrinho } from './ports/cardapio-de-precos.js';
import type { EnderecoDigitado, LocalizadorEndereco, LojaParaPedidos } from './ports/loja-para-pedidos.js';
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
  detalhes: DetalhesPedido = {},
): Promise<Pedido> {
  const erros = validarCarrinho(carrinho);
  if (erros.length > 0) {
    throw new DomainError(erros.join(' '), 'CARRINHO_INVALIDO');
  }

  const codigoCurto = await gerarCodigoUnico(repositorio);
  const expiraEm = new Date(agora.getTime() + ttlMinutos * 60_000);
  const taxaEntrega = detalhes.taxaEntrega ?? 0;

  return repositorio.criar({
    ...detalhes,
    modalidade: detalhes.modalidade ?? 'RETIRADA',
    taxaEntrega,
    codigoCurto,
    empreendedorId: carrinho.empreendedorId,
    status: 'AGUARDANDO_CONFIRMACAO',
    valorTotal: arredondar(calcularValorTotal(carrinho.itens) + taxaEntrega),
    itens: carrinho.itens,
    expiraEm,
    criadoEm: agora,
  });
}

export interface CriarPedidoDoCarrinhoDeps {
  ordersRepo: OrdersRepository;
  cardapioDePrecos: CardapioDePrecos;
  lojaParaPedidos: LojaParaPedidos;
  /** Sem ele (ex.: sem chave do Google), a loja só aceita retirada. */
  localizador?: LocalizadorEndereco;
  pedidoTtlMinutos: number;
}

export interface CarrinhoDoApp {
  empreendedorId: string;
  itens: ItemCarrinho[];
  modalidade: ModalidadePedido;
  /** Obrigatório na entrega. */
  endereco?: EnderecoDigitado;
  nomeCliente?: string;
  observacao?: string;
  /** Padrão PIX. */
  formaPagamento?: FormaPagamento;
  /** Só no dinheiro. */
  trocoPara?: number;
}

/**
 * Carrinho do app do cliente. Os preços vêm do cardápio e a taxa de entrega é
 * recalculada aqui, então o valor do PIX é sempre o que o servidor calculou.
 */
export async function criarPedidoDoCarrinho(
  deps: CriarPedidoDoCarrinhoDeps,
  carrinho: CarrinhoDoApp,
  agora: Date = new Date(),
): Promise<Pedido> {
  const itens = await deps.cardapioDePrecos.precificar(carrinho.empreendedorId, carrinho.itens);
  const regras = await deps.lojaParaPedidos.regrasDe(carrinho.empreendedorId);
  if (!regras) {
    throw new DomainError('Loja não encontrada.', 'LOJA_NAO_ENCONTRADA', 'NAO_ENCONTRADO');
  }

  if (!regras.cadastroCompleto) {
    throw new DomainError(
      'Esta loja ainda está terminando o cadastro e não recebe pedidos.',
      'LOJA_EM_MONTAGEM',
    );
  }
  if (!lojaAberta(regras.horarios, agora, regras.fuso)) {
    throw new DomainError('A loja está fechada agora.', 'LOJA_FECHADA');
  }
  const subtotal = calcularValorTotal(itens);
  if (regras.pedidoMinimo !== undefined && subtotal < regras.pedidoMinimo) {
    throw new DomainError(
      `O pedido mínimo desta loja é R$ ${regras.pedidoMinimo.toFixed(2)}, sem contar a entrega.`,
      'PEDIDO_ABAIXO_MINIMO',
    );
  }

  const formaPagamento = carrinho.formaPagamento ?? 'PIX';
  if (pagaNaEntrega(formaPagamento) && !regras.aceitaPagamentoNaEntrega) {
    throw new DomainError('Esta loja só aceita pagamento por PIX.', 'PAGAMENTO_NA_ENTREGA_INDISPONIVEL');
  }

  const detalhes: DetalhesPedido = {
    modalidade: carrinho.modalidade,
    nomeCliente: carrinho.nomeCliente,
    observacao: carrinho.observacao,
    formaPagamento,
    trocoPara: formaPagamento === 'DINHEIRO' ? carrinho.trocoPara : undefined,
  };
  if (carrinho.modalidade === 'RETIRADA') {
    if (!regras.aceitaRetirada) {
      throw new DomainError('Esta loja não aceita retirada, só entrega.', 'RETIRADA_INDISPONIVEL');
    }
  } else {
    if (!carrinho.endereco) {
      throw new DomainError('Informe o endereço de entrega.', 'ENDERECO_INVALIDO');
    }
    const cotacao = await cotarEntrega(regras, deps.localizador, carrinho.endereco);
    detalhes.taxaEntrega = cotacao.taxa;
    detalhes.entrega = cotacao.endereco;
  }

  const total = arredondar(subtotal + (detalhes.taxaEntrega ?? 0));
  if (detalhes.trocoPara !== undefined && detalhes.trocoPara < total) {
    throw new DomainError(
      `O troco precisa ser para um valor a partir de R$ ${total.toFixed(2)}, o total do pedido.`,
      'TROCO_INVALIDO',
    );
  }

  return criarPedido(
    deps.ordersRepo,
    { empreendedorId: carrinho.empreendedorId, itens },
    deps.pedidoTtlMinutos,
    agora,
    detalhes,
  );
}

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}
