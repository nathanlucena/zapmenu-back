-- AlterEnum
ALTER TYPE "ModalidadePedido" ADD VALUE 'ENVIO';

-- AlterTable
ALTER TABLE "Loja" ADD COLUMN     "aceitaEnvio" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "freteEnvio" DECIMAL(10,2),
ADD COLUMN     "fretePorUf" JSONB NOT NULL DEFAULT '{}';

