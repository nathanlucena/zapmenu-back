import type { PrismaClient } from '@prisma/client';
import type { Medidas } from '../domain/pacote.js';
import type { ContasMelhorEnvioRepository } from '../application/ports/contas-melhor-envio.repository.js';

function medidas(linha: { pesoGramas: number | null; alturaCm: unknown; larguraCm: unknown; comprimentoCm: unknown } | null): Medidas {
  if (!linha) return {};
  const numero = (valor: unknown) => (valor === null || valor === undefined ? undefined : Number(valor));
  return {
    pesoGramas: linha.pesoGramas ?? undefined,
    alturaCm: numero(linha.alturaCm),
    larguraCm: numero(linha.larguraCm),
    comprimentoCm: numero(linha.comprimentoCm),
  };
}

export function criarContasMelhorEnvioRepositoryPrisma(prisma: PrismaClient): ContasMelhorEnvioRepository {
  return {
    async daLoja(identificador) {
      const loja = await prisma.loja.findFirst({
        where: { OR: [{ id: identificador }, { empreendedorId: identificador }, { empreendedor: { telefone: identificador } }] },
        include: { empreendedor: true, contaMelhorEnvio: true },
      });
      if (!loja) return null;
      const conta = loja.contaMelhorEnvio;
      return {
        lojaId: loja.id,
        telefone: loja.empreendedor.telefone,
        tokens: conta ? { accessToken: conta.accessToken, refreshToken: conta.refreshToken, expiraEm: conta.expiraEm } : undefined,
        falhaDesde: conta?.falhaDesde ?? undefined,
        avisoFalhaEm: conta?.avisoFalhaEm ?? undefined,
      };
    },

    async salvarTokens(lojaId, tokens) {
      await prisma.contaMelhorEnvio.upsert({
        where: { lojaId },
        update: { ...tokens, falhaDesde: null },
        create: { lojaId, ...tokens },
      });
    },

    async registrarFalha(lojaId, desde) {
      await prisma.contaMelhorEnvio.updateMany({ where: { lojaId }, data: { falhaDesde: desde } });
    },

    async registrarAvisoDeFalha(lojaId, em) {
      await prisma.contaMelhorEnvio.updateMany({ where: { lojaId }, data: { avisoFalhaEm: em } });
    },

    async limparFalha(lojaId) {
      await prisma.contaMelhorEnvio.updateMany({ where: { lojaId }, data: { falhaDesde: null } });
    },

    async medidasDosItens(itemIds) {
      const itens = await prisma.itemCardapio.findMany({ where: { id: { in: itemIds } }, include: { categoria: true } });
      return new Map(itens.map((item) => [item.id, { produto: medidas(item), categoria: medidas(item.categoria) }]));
    },

    async remetente(lojaId) {
      const loja = await prisma.loja.findUnique({ where: { id: lojaId }, include: { empreendedor: true } });
      const cep = (loja?.cepOrigem ?? loja?.cep ?? '').replace(/\D/g, '');
      if (!loja || !loja.logradouro || !loja.numero || cep.length !== 8) return null;
      return {
        nome: loja.nome ?? loja.empreendedor.nome,
        telefone: loja.empreendedor.telefone,
        cep,
        logradouro: loja.logradouro,
        numero: loja.numero,
        complemento: loja.complemento ?? undefined,
        bairro: loja.bairro ?? undefined,
        cidade: loja.cidade ?? undefined,
        uf: loja.uf ?? undefined,
      };
    },
  };
}
