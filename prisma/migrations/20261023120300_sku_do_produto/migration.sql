-- AlterTable
ALTER TABLE "ItemPedido" ADD COLUMN     "skuId" TEXT;

-- CreateTable
CREATE TABLE "Sku" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "tamanho" TEXT,
    "cor" TEXT,
    "estoque" INTEGER NOT NULL DEFAULT 0,
    "preco" DECIMAL(10,2),
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Sku_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sku_itemId_tamanho_cor_key" ON "Sku"("itemId", "tamanho", "cor");

-- AddForeignKey
ALTER TABLE "Sku" ADD CONSTRAINT "Sku_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ItemCardapio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPedido" ADD CONSTRAINT "ItemPedido_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE SET NULL ON UPDATE CASCADE;

