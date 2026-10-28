-- CreateEnum
CREATE TYPE "TipoPromocao" AS ENUM ('PRECO_FIXO', 'PERCENTUAL');

-- CreateTable
CREATE TABLE "Promocao" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "tipo" "TipoPromocao" NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "diasSemana" INTEGER[],
    "horaInicio" TEXT,
    "horaFim" TEXT,
    "inicio" TIMESTAMP(3),
    "fim" TIMESTAMP(3),
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "avisoFimEm" TIMESTAMP(3),
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Promocao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromocaoAlvo" (
    "id" TEXT NOT NULL,
    "promocaoId" TEXT NOT NULL,
    "itemId" TEXT,
    "categoriaId" TEXT,

    CONSTRAINT "PromocaoAlvo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Promocao_lojaId_idx" ON "Promocao"("lojaId");

-- CreateIndex
CREATE INDEX "PromocaoAlvo_promocaoId_idx" ON "PromocaoAlvo"("promocaoId");

-- AddForeignKey
ALTER TABLE "Promocao" ADD CONSTRAINT "Promocao_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromocaoAlvo" ADD CONSTRAINT "PromocaoAlvo_promocaoId_fkey" FOREIGN KEY ("promocaoId") REFERENCES "Promocao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromocaoAlvo" ADD CONSTRAINT "PromocaoAlvo_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ItemCardapio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromocaoAlvo" ADD CONSTRAINT "PromocaoAlvo_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

