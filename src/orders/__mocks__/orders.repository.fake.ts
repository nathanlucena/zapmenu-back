import { DomainError } from '../../shared/errors/domain-error.js';
import type { OrdersRepository } from '../application/ports/orders.repository.js';
import { estaExpirado, STATUS_QUE_CONCLUEM_SOZINHOS, type FaltaEstoque, type Pedido } from '../domain/pedido.js';

let proximoId = 1;

export interface OrdersRepositoryFake extends OrdersRepository {
  /** O fake não conhece pagamentos: o teste diz qual PIX o pedido tem. */
  definirPix(pedidoId: string, pix: { copiaCola: string; qrCodeBase64?: string }): void;
  /** O fake não conhece o cardápio: o teste diz o estoque de cada SKU. */
  definirEstoque(skuId: string, estoque: number): void;
  estoqueDe(skuId: string): number | undefined;
}

export function criarOrdersRepositoryFake(): OrdersRepositoryFake {
  const pedidos = new Map<string, Pedido>();
  const pixPorPedido = new Map<string, { copiaCola: string; qrCodeBase64?: string }>();
  const estoquePorSku = new Map<string, number>();

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
        codigoRastreio: pedido.codigoRastreio,
        transportadora: pedido.transportadora,
        pix: status === 'AGUARDANDO_PAGAMENTO' ? pixPorPedido.get(pedido.id) : undefined,
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

    async buscarPorEnquete(enqueteId: string) {
      return (
        Array.from(pedidos.values()).find(
          (pedido) => pedido.enqueteAceiteId === enqueteId || pedido.enqueteAndamentoId === enqueteId,
        ) ?? null
      );
    },

    async listarPorStatus(status) {
      return Array.from(pedidos.values()).filter((pedido) => pedido.status === status);
    },

    async listarEmAndamentoAntesDe(limite: Date) {
      return Array.from(pedidos.values()).filter(
        (pedido) =>
          STATUS_QUE_CONCLUEM_SOZINHOS.includes(pedido.status) &&
          pedido.criadoEm < limite &&
          !pedido.itens.some((item) => item.skuId),
      );
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

    async atualizarSeStatus(id, de, alteracoes) {
      const pedido = pedidos.get(id);
      if (!pedido || pedido.status !== de) {
        return null;
      }
      const atualizado = { ...pedido, ...alteracoes };
      pedidos.set(id, atualizado);
      return atualizado;
    },

    definirPix(pedidoId, pix) {
      pixPorPedido.set(pedidoId, pix);
    },

    definirEstoque(skuId, estoque) {
      estoquePorSku.set(skuId, estoque);
    },

    estoqueDe(skuId) {
      return estoquePorSku.get(skuId);
    },

    async faltasDeEstoque(id) {
      const total = new Map<string, number>();
      for (const { skuId, quantidade } of pedidos.get(id)?.itens ?? []) {
        if (skuId) total.set(skuId, (total.get(skuId) ?? 0) + quantidade);
      }
      return [...total]
        .map(([skuId, quantidade]) => ({ skuId, quantidade, disponivel: Math.max(estoquePorSku.get(skuId) ?? 0, 0) }))
        .filter((falta) => falta.disponivel < falta.quantidade);
    },

    async registrarVenda(id, venda) {
      const pedido = pedidos.get(id);
      if (!pedido || pedido.status !== venda.de) {
        return { tipo: 'JA_REGISTRADA' };
      }
      const total = new Map<string, number>();
      for (const { skuId, quantidade } of pedido.itens) {
        if (skuId) total.set(skuId, (total.get(skuId) ?? 0) + quantidade);
      }
      const faltas: FaltaEstoque[] = [];
      const baixas = new Map<string, number>();
      for (const [skuId, quantidade] of total) {
        const disponivel = Math.max(estoquePorSku.get(skuId) ?? 0, 0);
        if (disponivel < quantidade) faltas.push({ skuId, quantidade, disponivel });
        baixas.set(skuId, Math.min(quantidade, disponivel));
      }
      if (faltas.length > 0 && venda.seFaltarEstoque === 'NAO_VENDER') {
        return { tipo: 'SEM_ESTOQUE', faltas };
      }
      for (const [skuId, baixa] of baixas) {
        estoquePorSku.set(skuId, (estoquePorSku.get(skuId) ?? 0) - baixa);
      }
      const vendido: Pedido = {
        ...pedido,
        status: venda.para,
        confirmadoEm: venda.confirmadoEm,
        ...(faltas.length > 0 && { faltaEstoque: faltas }),
      };
      pedidos.set(id, vendido);
      return { tipo: 'REGISTRADA', pedido: vendido };
    },

    async listarExpirados(agora: Date) {
      return Array.from(pedidos.values()).filter((pedido) => estaExpirado(pedido, agora));
    },
  };
}
