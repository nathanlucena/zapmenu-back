-- Feita à mão: o Prisma não gera NULLS NOT DISTINCT. Sem isso, dois SKUs "M" sem
-- cor (ou sem tamanho) passariam, porque no Postgres NULL nunca é igual a NULL.
-- Mesmo nome do índice do @@unique do schema, para o Prisma não ver diferença.
DROP INDEX "Sku_itemId_tamanho_cor_key";

CREATE UNIQUE INDEX "Sku_itemId_tamanho_cor_key" ON "Sku"("itemId", "tamanho", "cor") NULLS NOT DISTINCT;
