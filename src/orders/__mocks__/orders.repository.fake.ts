import { DomainError } from '../../shared/errors/domain-error.js';
import type { OrdersRepository } from '../application/ports/orders.repository.js';
import { estaExpirado, type Pedido } from '../domain/pedido.js';

let proximoId = 1;

export function criarOrdersRepositoryFake(): OrdersRepository {
  const pedidos = new Map<string, Pedido>();

  return {
    async codigoJaExiste(codigoCurto: string) {
      return Array.from(pedidos.values()).some((pedido) => pedido.codigoCurto === codigoCurto);
    },

    async criar(dadosPedido: Omit<Pedido, 'id'>) {
      const pedido: Pedido = {
        ...dadosPedido,
        modalidade: dadosPedido.modalidade ?? 'RETIRADA',
        taxaEntrega: dadosPedido.taxaEntrega ?? 0,
        id: `pedido-${proximoId++}`,
      };
      pedidos.set(pedido.id, pedido);
      return pedido;
    },

    async buscarResumoPublico(codigoCurto: string) {
      const pedido = Array.from(pedidos.values()).find((candidato) => candidato.codigoCurto === codigoCurto);
      if (!pedido) {
        return null;
      }
      const { status, valorTotal, expiraEm, criadoEm } = pedido;
      return {
        codigoCurto,
        status,
        modalidade: pedido.modalidade ?? 'RETIRADA',
        formaPagamento: pedido.formaPagamento ?? 'PIX',
        trocoPara: pedido.trocoPara,
        taxaEntrega: pedido.taxaEntrega ?? 0,
        valorTotal,
        expiraEm,
        criadoEm,
        // O fake não conhece o cardápio: usa o id do item como nome.
        itens: pedido.itens.map(({ itemCardapioId, quantidade, precoUnitario, variacaoEscolhida, observacao }) => ({
          nome: itemCardapioId,
          quantidade,
          precoUnitario,
          variacaoEscolhida,
          observacao,
        })),
      };
    },

    async buscarPorId(id: string) {
      return pedidos.get(id) ?? null;
    },

    async buscarPorCodigo(codigoCurto: string) {
      return Array.from(pedidos.values()).find((pedido) => pedido.codigoCurto === codigoCurto) ?? null;
    },

    async buscarPorEnquete(enqueteAceiteId: string) {
      return Array.from(pedidos.values()).find((pedido) => pedido.enqueteAceiteId === enqueteAceiteId) ?? null;
    },

    async atualizar(id: string, alteracoes) {
      const pedido = pedidos.get(id);
      if (!pedido) {
        throw new DomainError(`Pedido ${id} não encontrado.`, 'PEDIDO_NAO_ENCONTRADO');
      }
      const atualizado = { ...pedido, ...alteracoes };
      pedidos.set(id, atualizado);
      return atualizado;
    },

    async listarExpirados(agora: Date) {
      return Array.from(pedidos.values()).filter((pedido) => estaExpirado(pedido, agora));
    },
  };
}
