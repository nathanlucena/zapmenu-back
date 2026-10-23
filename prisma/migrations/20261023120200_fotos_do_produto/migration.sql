-- CreateTable
CREATE TABLE "FotoProduto" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "cor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FotoProduto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FotoProduto_itemId_idx" ON "FotoProduto"("itemId");

-- AddForeignKey
ALTER TABLE "FotoProduto" ADD CONSTRAINT "FotoProduto_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ItemCardapio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

