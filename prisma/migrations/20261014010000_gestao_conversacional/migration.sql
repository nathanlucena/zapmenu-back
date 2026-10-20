-- O formato do contexto mudou (rascunho + histórico); conversas em andamento
-- recomeçam do zero. OCIOSO existe nos dois enums.
UPDATE "EstadoConversa" SET "estado" = 'OCIOSO', "contexto" = '{}' WHERE "estado" <> 'OCIOSO';

-- AlterEnum
BEGIN;
CREATE TYPE "EstadoConversaEnum_new" AS ENUM ('OCIOSO', 'CONVERSANDO', 'CONFIRMANDO');
ALTER TABLE "public"."EstadoConversa" ALTER COLUMN "estado" DROP DEFAULT;
ALTER TABLE "EstadoConversa" ALTER COLUMN "estado" TYPE "EstadoConversaEnum_new" USING ("estado"::text::"EstadoConversaEnum_new");
ALTER TYPE "EstadoConversaEnum" RENAME TO "EstadoConversaEnum_old";
ALTER TYPE "EstadoConversaEnum_new" RENAME TO "EstadoConversaEnum";
DROP TYPE "public"."EstadoConversaEnum_old";
ALTER TABLE "EstadoConversa" ALTER COLUMN "estado" SET DEFAULT 'OCIOSO';
COMMIT;

-- AlterTable
ALTER TABLE "ItemCardapio" ADD COLUMN     "categoriaId" TEXT;

-- CreateTable
CREATE TABLE "Categoria" (
    "id" TEXT NOT NULL,
    "cardapioId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Categoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loja" (
    "id" TEXT NOT NULL,
    "empreendedorId" TEXT NOT NULL,
    "nome" TEXT,
    "descricao" TEXT,
    "endereco" TEXT,
    "aceitaRetirada" BOOLEAN NOT NULL DEFAULT true,
    "fazEntrega" BOOLEAN NOT NULL DEFAULT false,
    "taxaEntrega" DECIMAL(10,2),
    "pedidoMinimo" DECIMAL(10,2),
    "horarios" JSONB NOT NULL DEFAULT '[]',
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loja_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Categoria_cardapioId_idx" ON "Categoria"("cardapioId");

-- CreateIndex
CREATE UNIQUE INDEX "Categoria_cardapioId_nome_key" ON "Categoria"("cardapioId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "Loja_empreendedorId_key" ON "Loja"("empreendedorId");

-- CreateIndex
CREATE INDEX "ItemCardapio_categoriaId_idx" ON "ItemCardapio"("categoriaId");

-- AddForeignKey
ALTER TABLE "Categoria" ADD CONSTRAINT "Categoria_cardapioId_fkey" FOREIGN KEY ("cardapioId") REFERENCES "Cardapio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loja" ADD CONSTRAINT "Loja_empreendedorId_fkey" FOREIGN KEY ("empreendedorId") REFERENCES "Empreendedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCardapio" ADD CONSTRAINT "ItemCardapio_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

