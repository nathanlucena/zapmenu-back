-- AlterTable
ALTER TABLE "Loja" ADD COLUMN     "capaUrl" TEXT,
ADD COLUMN     "corDestaque" TEXT,
ADD COLUMN     "fuso" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Loja_slug_key" ON "Loja"("slug");

