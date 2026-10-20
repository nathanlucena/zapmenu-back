-- CreateEnum
CREATE TYPE "ModalidadePedido" AS ENUM ('RETIRADA', 'ENTREGA');

-- AlterTable
ALTER TABLE "Pedido" ADD COLUMN     "enderecoEntrega" JSONB,
ADD COLUMN     "modalidade" "ModalidadePedido" NOT NULL DEFAULT 'RETIRADA',
ADD COLUMN     "nomeCliente" TEXT,
ADD COLUMN     "observacao" TEXT,
ADD COLUMN     "taxaEntrega" DECIMAL(10,2) NOT NULL DEFAULT 0;

