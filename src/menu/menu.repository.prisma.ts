import type { Prisma, PrismaClient } from '@prisma/client';
import { DomainError } from '../shared/errors/domain-error.js';
import type { HorarioFuncionamento } from '../orders/domain/horario-loja.js';
import type { RegrasDaLoja } from '../orders/application/ports/loja-para-pedidos.js';
import { empreendedorPorIdentificador } from '../shared/db/identificador-loja.js';
import type { MenuRepository } from './menu.repository.js';
import type { FaixaEntrega } from './conversation/conversation-state.types.js';
import { entregaConfigurada, raioMaximoKm } from './entrega.js';
import { enderecoVerificadoDaLoja } from './gestao/gestao.repository.prisma.js';
import type { CardapioPublico, HorarioLoja, ItemCardapio, ItemDraft, VariacaoOpcao } from './menu.types.js';
import { cadastroCompleto, type LojaParaCadastro } from './cadastro-da-loja.js';

/** Os dados da loja salva que contam para o cadastro obrigatório. */
function lojaParaCadastro(loja: {
  nome: string | null;
  slug: string | null;
  aceitaRetirada: boolean;
  fazEntrega: boolean;
  latitude: unknown;
  longitude: unknown;
  faixasEntrega: unknown;
  horarios: unknown;
}): LojaParaCadastro {
  return {
    nome: loja.nome ?? undefined,
    slug: loja.slug ?? undefined,
    aceitaRetirada: loja.aceitaRetirada,
    fazEntrega: loja.fazEntrega,
    enderecoConfirmado: loja.latitude !== null && loja.longitude !== null,
    faixasEntrega: Array.isArray(loja.faixasEntrega) ? loja.faixasEntrega : [],
    horarios: Array.isArray(loja.horarios) ? loja.horarios : [],
  };
}

type ItemCardapioComVariacoes = Prisma.ItemCardapioGetPayload<{ include: { variacoes: true } }>;

function paraItemCardapio(item: ItemCardapioComVariacoes): ItemCardapio {
  return {
    id: item.id,
    cardapioId: item.cardapioId,
    categoriaId: item.categoriaId ?? undefined,
    nome: item.nome,
    descricao: item.descricao ?? undefined,
    precoBase: Number(item.precoBase),
    imagemUrl: item.imagemUrl ?? undefined,
    ativo: item.ativo,
    variacoes: item.variacoes.map((variacao) => ({
      nome: variacao.nome,
      opcoes: variacao.opcoes as unknown as VariacaoOpcao[],
    })),
  };
}

/**
 * Na escrita, o identificador é o telefone do empreendedor (chave natural de
 * multi-tenancy); na leitura pública, também vale o link curto da loja. Só a
 * escrita de itens cria o registro: uma URL inventada não vira empreendedor.
 */
export function criarMenuRepositoryPrisma(prisma: PrismaClient): MenuRepository {
  async function atualizarDoCardapio(
    cardapioId: string,
    itemId: string,
    dados: Prisma.ItemCardapioUpdateManyMutationInput,
  ): Promise<void> {
    const { count } = await prisma.itemCardapio.updateMany({
      where: { id: itemId, cardapioId, removidoEm: null },
      data: dados,
    });
    if (count === 0) {
      throw new DomainError(`Item ${itemId} não encontrado neste cardápio.`, 'ITEM_NAO_ENCONTRADO');
    }
  }

  async function obterOuCriarCardapio(telefoneEmpreendedor: string) {
    const empreendedor = await prisma.empreendedor.upsert({
      where: { telefone: telefoneEmpreendedor },
      update: {},
      create: { telefone: telefoneEmpreendedor, nome: telefoneEmpreendedor },
    });
    const cardapio = await prisma.cardapio.upsert({
      where: { empreendedorId: empreendedor.id },
      update: {},
      create: { empreendedorId: empreendedor.id },
    });
    return { empreendedorId: empreendedor.id, cardapioId: cardapio.id };
  }

  return {
    async obterCardapioPublico(identificador: string) {
      const empreendedor = await prisma.empreendedor.findFirst({ where: empreendedorPorIdentificador(identificador) });
      if (!empreendedor) {
        return null;
      }
      const empreendedorId = empreendedor.id;
      // Filtra pelo dono em vez do id do cardápio: quem ainda não tem cardápio recebe listas vazias.
      const doCardapio = { cardapio: { empreendedorId } };
      const [categorias, itens, loja] = await Promise.all([
        prisma.categoria.findMany({ where: doCardapio, orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }] }),
        prisma.itemCardapio.findMany({
          where: { ...doCardapio, ativo: true, removidoEm: null },
          include: { variacoes: true },
          orderBy: { criadoEm: 'asc' },
        }),
        prisma.loja.findUnique({ where: { empreendedorId } }),
      ]);

      const disponiveis = itens.map(paraItemCardapio);
      const secoes = [
        ...categorias.map((categoria) => ({
          id: categoria.id as string | null,
          nome: categoria.nome,
          itens: disponiveis.filter((item) => item.categoriaId === categoria.id),
        })),
        { id: null, nome: 'Outros', itens: disponiveis.filter((item) => !item.categoriaId) },
      ].filter((secao) => secao.itens.length > 0);

      const faixasEntrega = (loja?.faixasEntrega ?? []) as unknown as FaixaEntrega[];
      const cardapio: CardapioPublico = {
        loja: loja && {
          nome: loja.nome ?? undefined,
          descricao: loja.descricao ?? undefined,
          endereco: loja.endereco ?? undefined,
          aceitaRetirada: loja.aceitaRetirada,
          aceitaPagamentoNaEntrega: loja.aceitaPagamentoNaEntrega,
          emMontagem: !cadastroCompleto(lojaParaCadastro(loja)),
          // Loja antiga (taxa fixa, sem endereço verificado ou faixas) não entrega até configurar.
          fazEntrega: loja.fazEntrega && entregaConfigurada({ enderecoVerificado: enderecoVerificadoDaLoja(loja), faixasEntrega }),
          faixasEntrega,
          raioMaximoKm: raioMaximoKm(faixasEntrega),
          taxaEntrega: loja.taxaEntrega === null ? undefined : Number(loja.taxaEntrega),
          pedidoMinimo: loja.pedidoMinimo === null ? undefined : Number(loja.pedidoMinimo),
          horarios: loja.horarios as unknown as HorarioLoja[],
          slug: loja.slug ?? undefined,
          capaUrl: loja.capaUrl ?? undefined,
          logoUrl: loja.logoUrl ?? undefined,
          corDestaque: loja.corDestaque ?? undefined,
          fuso: loja.fuso,
        },
        secoes,
        itens: disponiveis,
      };
      return cardapio;
    },

    async obterRegrasDePedido(identificador: string) {
      const empreendedor = await prisma.empreendedor.findFirst({
        where: empreendedorPorIdentificador(identificador),
        include: { loja: true },
      });
      if (!empreendedor) {
        return null;
      }
      const { loja } = empreendedor;
      if (!loja) {
        // Loja sem nada configurado: os mesmos padrões do schema.
        return {
          aceitaRetirada: true,
          fazEntrega: false,
          aceitaPagamentoNaEntrega: true,
          faixasEntrega: [],
          horarios: [],
          cadastroCompleto: false,
        };
      }
      const regras: RegrasDaLoja = {
        aceitaRetirada: loja.aceitaRetirada,
        fazEntrega: loja.fazEntrega,
        aceitaPagamentoNaEntrega: loja.aceitaPagamentoNaEntrega,
        cadastroCompleto: cadastroCompleto(lojaParaCadastro(loja)),
        origem:
          loja.latitude === null || loja.longitude === null
            ? undefined
            : { latitude: Number(loja.latitude), longitude: Number(loja.longitude) },
        faixasEntrega: loja.faixasEntrega as unknown as FaixaEntrega[],
        pedidoMinimo: loja.pedidoMinimo === null ? undefined : Number(loja.pedidoMinimo),
        horarios: loja.horarios as unknown as HorarioFuncionamento[],
        fuso: loja.fuso,
      };
      return regras;
    },

    async obterOuCriarCardapio(telefoneEmpreendedor: string) {
      const { cardapioId } = await obterOuCriarCardapio(telefoneEmpreendedor);
      return { id: cardapioId };
    },

    async adicionarItem(cardapioId: string, draft: ItemDraft) {
      const item = await prisma.itemCardapio.create({
        data: {
          cardapioId,
          nome: draft.nome,
          descricao: draft.descricao,
          precoBase: draft.precoBase,
          imagemUrl: draft.imagemUrl,
          variacoes: {
            create: draft.variacoes.map((variacao) => ({
              nome: variacao.nome,
              opcoes: variacao.opcoes as unknown as Prisma.InputJsonValue,
            })),
          },
        },
        include: { variacoes: true },
      });
      return paraItemCardapio(item);
    },

    async listarItensAtivos(cardapioId: string) {
      const itens = await prisma.itemCardapio.findMany({
        where: { cardapioId, ativo: true, removidoEm: null },
        include: { variacoes: true },
        orderBy: { criadoEm: 'asc' },
      });
      return itens.map(paraItemCardapio);
    },

    async listarItens(cardapioId: string) {
      const itens = await prisma.itemCardapio.findMany({
        where: { cardapioId, removidoEm: null },
        include: { variacoes: true },
        orderBy: { criadoEm: 'asc' },
      });
      return itens.map(paraItemCardapio);
    },

    async atualizarItem(cardapioId, itemId, alteracoes) {
      await atualizarDoCardapio(cardapioId, itemId, alteracoes);
    },

    async definirAtivo(cardapioId, itemId, ativo) {
      await atualizarDoCardapio(cardapioId, itemId, { ativo });
    },

    async removerItem(cardapioId, itemId) {
      await atualizarDoCardapio(cardapioId, itemId, { ativo: false, removidoEm: new Date() });
    },
  };
}
