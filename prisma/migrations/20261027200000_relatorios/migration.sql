-- CreateEnum
CREATE TYPE "TipoRelatorio" AS ENUM ('SEMANAL', 'DIARIO');

-- AlterTable
ALTER TABLE "Loja" ADD COLUMN     "relatorioDiario" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "RelatorioEnviado" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "tipo" "TipoRelatorio" NOT NULL,
    "chave" TEXT NOT NULL,
    "enviadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelatorioEnviado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RelatorioEnviado_lojaId_tipo_chave_key" ON "RelatorioEnviado"("lojaId", "tipo", "chave");

-- AddForeignKey
ALTER TABLE "RelatorioEnviado" ADD CONSTRAINT "RelatorioEnviado_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

