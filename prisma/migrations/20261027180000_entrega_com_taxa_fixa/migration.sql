-- CreateEnum
CREATE TYPE "ModoEntrega" AS ENUM ('FIXA', 'DISTANCIA');

-- AlterTable
ALTER TABLE "Loja" ADD COLUMN     "modoEntrega" "ModoEntrega" NOT NULL DEFAULT 'DISTANCIA',
ADD COLUMN     "raioEntregaKm" DECIMAL(5,2);

