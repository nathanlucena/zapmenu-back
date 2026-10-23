-- CreateEnum
CREATE TYPE "SegmentoLoja" AS ENUM ('COMIDA', 'VAREJO', 'SERVICOS');

-- AlterTable
ALTER TABLE "Loja" ADD COLUMN     "segmento" "SegmentoLoja" NOT NULL DEFAULT 'COMIDA';

