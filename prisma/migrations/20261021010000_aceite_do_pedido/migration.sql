-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StatusPedido" ADD VALUE 'AGUARDANDO_ACEITE';
ALTER TYPE "StatusPedido" ADD VALUE 'RECUSADO';

-- AlterTable
ALTER TABLE "Pedido" ADD COLUMN     "enqueteAceiteId" TEXT;

-- CreateTable
CREATE TABLE "EnqueteWhatsApp" (
    "id" TEXT NOT NULL,
    "segredo" TEXT NOT NULL,
    "criadorJid" TEXT NOT NULL,
    "opcoes" JSONB NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnqueteWhatsApp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pedido_enqueteAceiteId_key" ON "Pedido"("enqueteAceiteId");

