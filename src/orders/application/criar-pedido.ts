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
import { enderecoDeEnvio } from './endereco-de-envio.js';
import type { CotadorDeFrete } from './ports/cotador-de-frete.js';
import type { CardapioDePrecos, ItemCarrinho } from './ports/cardapio-de-precos.js';
import type {
  ConsultaCepParaEnvio,
  EnderecoDigitado,
  LocalizadorEndereco,
  LojaParaPedidos,
} from './ports/loja-para-pedidos.js';
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
  /** Completa o endereço pelo CEP no envio por transportadora. */
  consultaCep?: ConsultaCepParaEnvio;
  /** Melhor Envio. Sem ele, não há envio por transportadora. */
  cotadorDeFrete?: CotadorDeFrete;
  pedidoTtlMinutos: number;
}

export interface CarrinhoDoApp {
  empreendedorId: string;
  itens: ItemCarrinho[];
  modalidade: ModalidadePedido;
  /** Obrigatório na entrega e no envio. */
  endereco?: EnderecoDigitado;
  nomeCliente?: string;
  observacao?: string;
  /** Padrão PIX. */
  formaPagamento?: FormaPagamento;
  /** Só no dinheiro. */
  trocoPara?: number;
  /** Só no Melhor Envio: o serviço escolhido na cotação (o preço é recalculado aqui). */
  servicoEnvioId?: string;
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

  if (regras.indisponivel) {
    throw new DomainError('Esta loja está temporariamente indisponível.', 'LOJA_INDISPONIVEL');
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
  if (pagaNaEntrega(formaPagamento) && carrinho.modalidade === 'MELHOR_ENVIO') {
    throw new DomainError('No envio por transportadora o pagamento é só por PIX.', 'PAGAMENTO_NA_ENTREGA_INDISPONIVEL');
  }
  if (carrinho.modalidade === 'ENVIO') {
    throw new DomainError('Esta forma de envio não existe mais. Escolha outra.', 'ENVIO_INDISPONIVEL');
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
    if (carrinho.modalidade === 'MELHOR_ENVIO') {
      if (!regras.melhorEnvio || !deps.cotadorDeFrete) {
        throw new DomainError('Esta loja não envia por transportadora.', 'ENVIO_INDISPONIVEL');
      }
      const endereco = await enderecoDeEnvio(deps.consultaCep, carrinho.endereco);
      const servicos = await deps.cotadorDeFrete.cotar(carrinho.empreendedorId, {
        cepOrigem: regras.melhorEnvio.cepOrigem,
        cepDestino: endereco.cep!,
        itens: itens.map((item) => ({ itemCardapioId: item.itemCardapioId, quantidade: item.quantidade, precoUnitario: item.precoUnitario })),
      });
      // O preço vale o do momento: o que o app mostrou é só referência.
      const servico = servicos.find((candidato) => candidato.id === carrinho.servicoEnvioId);
      if (!servico) {
        throw new DomainError('Esse frete não está mais disponível. Escolha de novo.', 'FRETE_MUDOU', 'CONFLITO');
      }
      detalhes.taxaEntrega = servico.preco;
      detalhes.entrega = endereco;
      detalhes.servicoEnvio = servico;
    } else {
      const cotacao = await cotarEntrega(regras, deps.localizador, carrinho.endereco);
      detalhes.taxaEntrega = cotacao.taxa;
      detalhes.entrega = cotacao.endereco;
    }
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
