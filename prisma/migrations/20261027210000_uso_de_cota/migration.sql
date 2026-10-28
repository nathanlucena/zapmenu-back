-- CreateTable
CREATE TABLE "UsoDeCota" (
    "id" TEXT NOT NULL,
    "empreendedorId" TEXT NOT NULL,
    "mes" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "usado" INTEGER NOT NULL DEFAULT 0,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsoDeCota_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UsoDeCota_empreendedorId_mes_chave_key" ON "UsoDeCota"("empreendedorId", "mes", "chave");

