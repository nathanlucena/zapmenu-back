import type { Prisma, PrismaClient } from '@prisma/client';
import { DomainError } from '../../shared/errors/domain-error.js';
import { gerarSlug, problemaNoSlug } from '../vitrine.js';
import type {
  DadosLoja,
  EnderecoVerificado,
  FaixaEntrega,
  FotoNova,
  Horario,
  LinhaGrade,
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
          include: { variacoes: true, categoria: true, skus: { where: { ativo: true }, orderBy: { id: 'asc' } } },
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
          imagemUrl: item.imagemUrl ?? undefined,
          categoriaId: item.categoriaId ?? undefined,
          categoriaNome: item.categoria?.nome,
          variacoes: paraVariacoes(item.variacoes),
          grade: item.skus.map((sku) => ({
            tamanho: sku.tamanho ?? undefined,
            cor: sku.cor ?? undefined,
            estoque: sku.estoque,
            preco: sku.preco === null ? undefined : Number(sku.preco),
          })),
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
              raioEntregaKm: loja.raioEntregaKm === null ? undefined : Number(loja.raioEntregaKm),
              modoEntrega: loja.modoEntrega,
              pedidoMinimo: loja.pedidoMinimo === null ? undefined : Number(loja.pedidoMinimo),
              horarios: loja.horarios as unknown as Horario[],
              slug: loja.slug ?? undefined,
              corDestaque: loja.corDestaque ?? undefined,
              instagram: loja.instagram ?? undefined,
              aceitaPagamentoNaEntrega: loja.aceitaPagamentoNaEntrega,
              aceitaEnvio: loja.aceitaEnvio,
              freteEnvio: loja.freteEnvio === null ? undefined : Number(loja.freteEnvio),
              fretePorUf: loja.fretePorUf as Record<string, number>,
              politicaTroca: loja.politicaTroca ?? undefined,
            }
          : {},
        lojaSalva: {
          existe: Boolean(loja),
          temLogo: Boolean(loja?.logoUrl),
          temCapa: Boolean(loja?.capaUrl),
          logoUrl: loja?.logoUrl ?? undefined,
          capaUrl: loja?.capaUrl ?? undefined,
          lembreteOpcionaisEm: loja?.lembreteOpcionaisEm ?? undefined,
          naoLembrarOpcionais: loja?.naoLembrarOpcionais ?? false,
          tipoPendente: !loja?.segmentoDefinido,
        },
        segmento: loja?.segmento,
      };
      return snapshot;
    },

    async definirSegmento(telefone, segmento) {
      const { empreendedorId } = await obterCardapio(prisma, telefone);
      await prisma.loja.upsert({
        where: { empreendedorId },
        update: { segmento, segmentoDefinido: true },
        create: { empreendedorId, segmento, segmentoDefinido: true },
      });
    },

    async registrarLembreteOpcionais(telefone, registro) {
      const { empreendedorId } = await obterCardapio(prisma, telefone);
      await prisma.loja.updateMany({
        where: { empreendedorId },
        data: definidos({ lembreteOpcionaisEm: registro.em, naoLembrarOpcionais: registro.desligar }),
      });
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
          garantirItemCompleto(novo);
          const criado = await tx.itemCardapio.create({
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
          if (novo.grade) {
            await sincronizarGrade(tx, criado.id, novo.grade);
          }
          if (novo.fotos?.length) {
            await acrescentarFotos(tx, criado.id, novo.fotos);
          }
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
          if (edicao.grade) {
            await sincronizarGrade(tx, edicao.itemId, edicao.grade);
          }
          if (edicao.fotos?.length) {
            await acrescentarFotos(tx, edicao.itemId, edicao.fotos);
          }
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

/**
 * Deixa os SKUs do item iguais à grade: atualiza ou cria cada combinação e
 * pausa as que saíram (pedidos antigos continuam apontando para elas).
 */
async function sincronizarGrade(tx: Tx, itemId: string, grade: LinhaGrade[]): Promise<void> {
  const existentes = await tx.sku.findMany({ where: { itemId } });
  const chave = (tamanho?: string | null, cor?: string | null) => `${tamanho?.toLowerCase() ?? ''}|${cor?.toLowerCase() ?? ''}`;
  const mantidos = new Set<string>();
  for (const linha of grade) {
    const existente = existentes.find((sku) => chave(sku.tamanho, sku.cor) === chave(linha.tamanho, linha.cor));
    const dados = { estoque: linha.estoque, preco: linha.preco ?? null, ativo: true };
    if (existente) {
      await tx.sku.update({ where: { id: existente.id }, data: dados });
      mantidos.add(existente.id);
    } else {
      await tx.sku.create({ data: { itemId, tamanho: linha.tamanho ?? null, cor: linha.cor ?? null, ...dados } });
    }
  }
  const pausar = existentes.filter((sku) => !mantidos.has(sku.id)).map((sku) => sku.id);
  if (pausar.length > 0) {
    await tx.sku.updateMany({ where: { id: { in: pausar } }, data: { ativo: false } });
  }
}

/** Fotos novas entram no fim da galeria, na ordem em que chegaram. */
async function acrescentarFotos(tx: Tx, itemId: string, fotos: FotoNova[]): Promise<void> {
  const ultima = await tx.fotoProduto.aggregate({ where: { itemId }, _max: { ordem: true } });
  const inicio = (ultima._max.ordem ?? -1) + 1;
  await tx.fotoProduto.createMany({
    data: fotos.map((foto, indice) => ({ itemId, url: foto.url, cor: foto.cor ?? null, ordem: inicio + indice })),
  });
}

function paraVariacaoPrisma(variacao: Variacao) {
  return { nome: variacao.nome, opcoes: variacao.opcoes as unknown as Prisma.InputJsonValue };
}

/** Item novo só é gravado com nome e preço (a IA às vezes deixa um dos dois para depois). */
export function garantirItemCompleto<T extends { nome?: string; precoBase?: number }>(
  novo: T,
): asserts novo is T & { nome: string; precoBase: number } {
  if (!novo.nome || novo.precoBase === undefined) {
    const qual = novo.nome ? `O item *${novo.nome}*` : 'Um dos itens novos';
    throw new DomainError(`${qual} está sem ${novo.nome ? 'preço' : 'nome'}.`, 'ITEM_INCOMPLETO');
  }
}

export async function atualizarItem(
  tx: Tx,
  cardapioId: string,
  itemId: string,
  dados: Prisma.ItemCardapioUncheckedUpdateManyInput,
): Promise<void> {
  const { count } = await tx.itemCardapio.updateMany({ where: { id: itemId, cardapioId, removidoEm: null }, data: dados });
  if (count === 0) {
    // O item sumiu entre o rascunho e o "sim" (removido em outra conversa, por exemplo).
    throw new DomainError('Um dos itens que você alterou não existe mais no cardápio.', 'ITEM_NAO_ENCONTRADO');
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
    taxaEntrega: loja.taxaEntrega,
    // 0 = "sem limite": a taxa fixa vale para qualquer distância.
    raioEntregaKm: loja.raioEntregaKm === 0 ? null : loja.raioEntregaKm,
    modoEntrega: loja.modoEntrega,
    pedidoMinimo: loja.pedidoMinimo,
    horarios: loja.horarios as unknown as Prisma.InputJsonValue | undefined,
    slug: loja.slug,
    corDestaque: loja.corDestaque,
    instagram: loja.instagram,
    // "" = tirar a foto.
    logoUrl: loja.logoUrl === '' ? null : loja.logoUrl,
    capaUrl: loja.capaUrl === '' ? null : loja.capaUrl,
    aceitaPagamentoNaEntrega: loja.aceitaPagamentoNaEntrega,
    aceitaEnvio: loja.aceitaEnvio,
    freteEnvio: loja.freteEnvio,
    fretePorUf: loja.fretePorUf as Prisma.InputJsonValue | undefined,
    politicaTroca: loja.politicaTroca,
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
  if (loja.slug !== undefined && (await slugDeOutraLoja(tx, loja.slug, empreendedorId))) {
    throw new DomainError(`O link ${loja.slug} já é de outra loja.`, 'SLUG_EM_USO', 'CONFLITO');
  }
  const salva = await tx.loja.upsert({ where: { empreendedorId }, update: dados, create: { empreendedorId, ...dados } });
  if (!salva.slug && salva.nome) {
    await tx.loja.update({ where: { id: salva.id }, data: { slug: await slugLivre(tx, salva.nome, empreendedorId) } });
  }
}

async function slugDeOutraLoja(tx: Tx, slug: string, empreendedorId: string): Promise<boolean> {
  return (await tx.loja.findFirst({ where: { slug, empreendedorId: { not: empreendedorId } } })) !== null;
}

/** Link gerado pelo nome da loja ("Bolos da Dona" → "bolos-da-dona", ou "bolos-da-dona-2" se já existir). */
async function slugLivre(tx: Tx, nome: string, empreendedorId: string): Promise<string | null> {
  const base = gerarSlug(nome);
  if (problemaNoSlug(base)) {
    return null;
  }
  for (let sufixo = 1; sufixo <= 50; sufixo++) {
    const candidato = sufixo === 1 ? base : `${base.slice(0, 36)}-${sufixo}`;
    if (!(await slugDeOutraLoja(tx, candidato, empreendedorId))) {
      return candidato;
    }
  }
  return null;
}
