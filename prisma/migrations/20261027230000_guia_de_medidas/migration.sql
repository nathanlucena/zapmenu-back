-- CreateTable
CREATE TABLE "GuiaMedidas" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "colunas" TEXT[],
    "linhas" JSONB NOT NULL,
    "categoriaId" TEXT,
    "itemId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuiaMedidas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuiaMedidas_categoriaId_key" ON "GuiaMedidas"("categoriaId");

-- CreateIndex
CREATE UNIQUE INDEX "GuiaMedidas_itemId_key" ON "GuiaMedidas"("itemId");

-- CreateIndex
CREATE INDEX "GuiaMedidas_lojaId_idx" ON "GuiaMedidas"("lojaId");

-- AddForeignKey
ALTER TABLE "GuiaMedidas" ADD CONSTRAINT "GuiaMedidas_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuiaMedidas" ADD CONSTRAINT "GuiaMedidas_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuiaMedidas" ADD CONSTRAINT "GuiaMedidas_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ItemCardapio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

