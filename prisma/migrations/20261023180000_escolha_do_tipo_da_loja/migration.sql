-- AlterTable
ALTER TABLE "Loja" ADD COLUMN     "segmentoDefinido" BOOLEAN NOT NULL DEFAULT false;


-- Feito à mão: quem já tinha loja segue como comida, sem a pergunta do tipo.
UPDATE "Loja" SET "segmentoDefinido" = true;
