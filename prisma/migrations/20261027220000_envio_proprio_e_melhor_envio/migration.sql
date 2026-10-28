-- AlterEnum
ALTER TYPE "ModalidadePedido" ADD VALUE 'MELHOR_ENVIO';

-- AlterTable
ALTER TABLE "Categoria" ADD COLUMN     "alturaCm" DECIMAL(6,1),
ADD COLUMN     "comprimentoCm" DECIMAL(6,1),
ADD COLUMN     "larguraCm" DECIMAL(6,1),
ADD COLUMN     "pesoGramas" INTEGER;

-- AlterTable: o frete fixo por região sai. Quem usava é avisado na gestão (e fica sem envio até configurar o novo).
ALTER TABLE "Loja" ADD COLUMN     "avisarFimDoFreteFixo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "usaMelhorEnvio" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Loja" SET "avisarFimDoFreteFixo" = true WHERE "aceitaEnvio" = true;

ALTER TABLE "Loja" DROP COLUMN "aceitaEnvio",
DROP COLUMN "freteEnvio",
DROP COLUMN "fretePorUf";

-- AlterTable
ALTER TABLE "ItemCardapio" ADD COLUMN     "alturaCm" DECIMAL(6,1),
ADD COLUMN     "comprimentoCm" DECIMAL(6,1),
ADD COLUMN     "larguraCm" DECIMAL(6,1),
ADD COLUMN     "pesoGramas" INTEGER;

-- AlterTable
ALTER TABLE "Pedido" ADD COLUMN     "etiquetaId" TEXT,
ADD COLUMN     "servicoEnvio" JSONB;

-- CreateTable
CREATE TABLE "ContaMelhorEnvio" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "falhaDesde" TIMESTAMP(3),
    "avisoFalhaEm" TIMESTAMP(3),
    "conectadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContaMelhorEnvio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContaMelhorEnvio_lojaId_key" ON "ContaMelhorEnvio"("lojaId");

-- AddForeignKey
ALTER TABLE "ContaMelhorEnvio" ADD CONSTRAINT "ContaMelhorEnvio_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

