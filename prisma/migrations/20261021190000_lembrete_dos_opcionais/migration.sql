-- AlterTable
ALTER TABLE "Loja" ADD COLUMN     "lembreteOpcionaisEm" TIMESTAMP(3),
ADD COLUMN     "naoLembrarOpcionais" BOOLEAN NOT NULL DEFAULT false;

