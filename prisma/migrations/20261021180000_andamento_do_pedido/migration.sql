-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StatusPedido" ADD VALUE 'SAIU_PARA_ENTREGA';
ALTER TYPE "StatusPedido" ADD VALUE 'PRONTO_PARA_RETIRADA';
ALTER TYPE "StatusPedido" ADD VALUE 'CONCLUIDO';

-- AlterTable
ALTER TABLE "Pedido" ADD COLUMN     "enqueteAndamentoId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Pedido_enqueteAndamentoId_key" ON "Pedido"("enqueteAndamentoId");

