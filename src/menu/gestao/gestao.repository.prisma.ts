import type { Prisma, PrismaClient } from '@prisma/client';
import { DomainError } from '../../shared/errors/domain-error.js';
import type {
  DadosLoja,
  EnderecoVerificado,
  FaixaEntrega,
  Horario,
  Rascunho,
  Variacao,
} from '../conversation/conversation-state.types.js';
import type { GestaoRepository, SnapshotCardapio } from './gestao.repository.js';

type Tx = Prisma.TransactionClient;

/** O empreendedor é identificado pelo telefone (ver menu.repository.prisma). */
async function obterCardapio(tx: Tx | PrismaClient, telefone: string) {
  const empreendedor = await tx.empreendedor.upsert({
    where: { telefone },
    update: {},
    create: { telefone, nome: telefone },
  });
  const cardapio = await tx.cardapio.upsert({
    where: { empreendedorId: empreendedor.id },
    update: {},
    create: { empreendedorId: empreendedor.id },
  });
  return { empreendedorId: empreendedor.id, cardapioId: cardapio.id };
}

function paraVariacoes(variacoes: { nome: string; opcoes: Prisma.JsonValue }[]): Variacao[] {
  return variacoes.map((variacao) => ({
    nome: variacao.nome,
    opcoes: variacao.opcoes as unknown as Variacao['opcoes'],
  }));
}

type LojaPrisma = NonNullable<Awaited<ReturnType<PrismaClient['loja']['findUnique']>>>;

/** Endereço verificado só existe com coordenada (que vem sempre do Google). */
export function enderecoVerificadoDaLoja(loja: LojaPrisma): EnderecoVerificado | undefined {
  if (loja.latitude === null || loja.longitude === null) {
    return undefined;
  }
  return {
    cep: loja.cep ?? undefined,
    logradouro: loja.logradouro ?? undefined,
    numero: loja.numero ?? 's/n',
    complemento: loja.complemento ?? undefined,
    bairro: loja.bairro ?? undefined,
    cidade: loja.cidade ?? undefined,
    uf: loja.uf ?? undefined,
    enderecoFormatado: loja.endereco ?? '',
    latitude: Number(loja.latitude),
    longitude: Number(loja.longitude),
    precisao: loja.precisaoEndereco ?? '',
  };
}

function definidos<T extends object>(dados: T): Partial<T> {
  return Object.fromEntries(Object.entries(dados).filter(([, valor]) => valor !== undefined)) as Partial<T>;
}

export function criarGestaoRepositoryPrisma(prisma: PrismaClient): GestaoRepository {
  return {
    async carregarSnapshot(telefone) {
      const { empreendedorId, cardapioId } = await obterCardapio(prisma, telefone);

      const [categorias, itens, loja] = await Promise.all([
        prisma.categoria.findMany({ where: { cardapioId }, orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }] }),
        prisma.itemCardapio.findMany({
          where: { cardapioId, removidoEm: null },
          include: { variacoes: true, categoria: true },
          orderBy: { criadoEm: 'asc' },
        }),
        prisma.loja.findUnique({ where: { empreendedorId } }),
      ]);

      const snapshot: SnapshotCardapio = {
        cardapioId,
        categorias: categorias.map(({ id, nome }) => ({ id, nome })),
        itens: itens.map((item) => ({
          id: item.id,
          nome: item.nome,
          descricao: item.descricao ?? undefined,
          precoBase: Number(item.precoBase),
          ativo: item.ativo,
          temFoto: Boolean(item.imagemUrl),
          categoriaId: item.categoriaId ?? undefined,
          categoriaNome: item.categoria?.nome,
          variacoes: paraVariacoes(item.variacoes),
        })),
        loja: loja
          ? {
              nome: loja.nome ?? undefined,
              descricao: loja.descricao ?? undefined,
              endereco: loja.endereco ?? undefined,
              enderecoVerificado: enderecoVerificadoDaLoja(loja),
              aceitaRetirada: loja.aceitaRetirada,
              fazEntrega: loja.fazEntrega,
              faixasEntrega: loja.faixasEntrega as unknown as FaixaEntrega[],
              taxaEntrega: loja.taxaEntrega === null ? undefined : Number(loja.taxaEntrega),
              pedidoMinimo: loja.pedidoMinimo === null ? undefined : Number(loja.pedidoMinimo),
              horarios: loja.horarios as unknown as Horario[],
            }
          : {},
      };
      return snapshot;
    },

    async salvarRascunho(telefone, rascunho) {
      await prisma.$transaction(async (tx) => {
        const { empreendedorId, cardapioId } = await obterCardapio(tx, telefone);

        if (rascunho.loja) {
          await salvarLoja(tx, empreendedorId, rascunho.loja);
        }

        for (const { categoriaId, novoNome } of rascunho.categoriasRenomeadas) {
          await tx.categoria.updateMany({ where: { id: categoriaId, cardapioId }, data: { nome: novoNome } });
        }
        if (rascunho.categoriasRemovidas.length > 0) {
          // Os itens dessas categorias ficam sem categoria (onDelete: SetNull).
          await tx.categoria.deleteMany({ where: { id: { in: rascunho.categoriasRemovidas }, cardapioId } });
        }

        const idCategoria = await criarResolvedorDeCategoria(tx, cardapioId);
        for (const nome of rascunho.novasCategorias) {
          await idCategoria(nome);
        }

        for (const novo of rascunho.novosItens) {
          if (!novo.nome || novo.precoBase === undefined) {
            throw new DomainError(`Item "${novo.nome ?? novo.ref}" está incompleto.`, 'ITEM_INCOMPLETO');
          }
          await tx.itemCardapio.create({
            data: {
              cardapioId,
              nome: novo.nome,
              descricao: novo.descricao,
              precoBase: novo.precoBase,
              imagemUrl: novo.imagemUrl,
              categoriaId: novo.categoria ? await idCategoria(novo.categoria) : undefined,
              variacoes: { create: (novo.variacoes ?? []).map(paraVariacaoPrisma) },
            },
          });
        }

        for (const edicao of rascunho.edicoes) {
          const dados: Prisma.ItemCardapioUncheckedUpdateManyInput = definidos({
            nome: edicao.nome,
            descricao: edicao.descricao,
            precoBase: edicao.precoBase,
            imagemUrl: edicao.imagemUrl,
          });
          if (edicao.categoria !== undefined) {
            dados.categoriaId = edicao.categoria === null ? null : await idCategoria(edicao.categoria);
          }
          await atualizarItem(tx, cardapioId, edicao.itemId, dados);
          if (edicao.variacoes) {
            await tx.variacao.deleteMany({ where: { itemId: edicao.itemId } });
            await tx.variacao.createMany({
              data: edicao.variacoes.map((variacao) => ({ itemId: edicao.itemId, ...paraVariacaoPrisma(variacao) })),
            });
          }
        }

        for (const { itemId, acao } of rascunho.status) {
          const dados: Prisma.ItemCardapioUncheckedUpdateManyInput =
            acao === 'REMOVER' ? { ativo: false, removidoEm: new Date() } : { ativo: acao === 'REATIVAR' };
          await atualizarItem(tx, cardapioId, itemId, dados);
        }
      });
    },
  };
}

function paraVariacaoPrisma(variacao: Variacao) {
  return { nome: variacao.nome, opcoes: variacao.opcoes as unknown as Prisma.InputJsonValue };
}

async function atualizarItem(
  tx: Tx,
  cardapioId: string,
  itemId: string,
  dados: Prisma.ItemCardapioUncheckedUpdateManyInput,
): Promise<void> {
  const { count } = await tx.itemCardapio.updateMany({ where: { id: itemId, cardapioId, removidoEm: null }, data: dados });
  if (count === 0) {
    throw new DomainError(`Item ${itemId} não encontrado neste cardápio.`, 'ITEM_NAO_ENCONTRADO');
  }
}

/** Nome → id da categoria (sem diferenciar maiúsculas), criando se não existir. */
async function criarResolvedorDeCategoria(tx: Tx, cardapioId: string) {
  const existentes = await tx.categoria.findMany({ where: { cardapioId } });
  const porNome = new Map(existentes.map((categoria) => [categoria.nome.toLowerCase(), categoria.id]));
  let proximaOrdem = existentes.reduce((maior, categoria) => Math.max(maior, categoria.ordem), -1) + 1;

  return async (nome: string): Promise<string> => {
    const chave = nome.trim().toLowerCase();
    const existente = porNome.get(chave);
    if (existente) {
      return existente;
    }
    const criada = await tx.categoria.create({ data: { cardapioId, nome: nome.trim(), ordem: proximaOrdem++ } });
    porNome.set(chave, criada.id);
    return criada.id;
  };
}

async function salvarLoja(tx: Tx, empreendedorId: string, loja: DadosLoja): Promise<void> {
  const endereco = loja.enderecoVerificado;
  const dados = definidos({
    nome: loja.nome,
    descricao: loja.descricao,
    endereco: endereco?.enderecoFormatado ?? loja.endereco,
    aceitaRetirada: loja.aceitaRetirada,
    fazEntrega: loja.fazEntrega,
    faixasEntrega: loja.faixasEntrega as unknown as Prisma.InputJsonValue | undefined,
    pedidoMinimo: loja.pedidoMinimo,
    horarios: loja.horarios as unknown as Prisma.InputJsonValue | undefined,
  });
  // O endereço é gravado inteiro (null limpa o que não veio), para não misturar com o anterior.
  const dadosEndereco = endereco && {
    cep: endereco.cep ?? null,
    logradouro: endereco.logradouro ?? null,
    numero: endereco.numero,
    complemento: endereco.complemento ?? null,
    bairro: endereco.bairro ?? null,
    cidade: endereco.cidade ?? null,
    uf: endereco.uf ?? null,
    latitude: endereco.latitude,
    longitude: endereco.longitude,
    precisaoEndereco: endereco.precisao,
  };
  Object.assign(dados, dadosEndereco);
  await tx.loja.upsert({ where: { empreendedorId }, update: dados, create: { empreendedorId, ...dados } });
}
