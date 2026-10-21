-- CreateEnum
CREATE TYPE "FormaPagamento" AS ENUM ('PIX', 'DINHEIRO', 'CARTAO');

-- AlterEnum
ALTER TYPE "StatusPedido" ADD VALUE 'CONFIRMADO';

-- AlterTable
ALTER TABLE "Loja" ADD COLUMN     "aceitaPagamentoNaEntrega" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Pedido" ADD COLUMN     "formaPagamento" "FormaPagamento" NOT NULL DEFAULT 'PIX',
ADD COLUMN     "trocoPara" DECIMAL(10,2);

