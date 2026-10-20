-- Conversas em andamento usam estados/contexto do fluxo antigo; voltam para
-- OCIOSO (válido nos dois enums) antes da troca de tipo.
UPDATE "EstadoConversa" SET "estado" = 'OCIOSO', "contexto" = '{}' WHERE "estado" <> 'OCIOSO';

-- AlterEnum
BEGIN;
CREATE TYPE "EstadoConversaEnum_new" AS ENUM ('OCIOSO', 'CADASTRANDO', 'AGUARDANDO_FOTO', 'EDITANDO_ITEM', 'CONFIRMANDO');
ALTER TABLE "public"."EstadoConversa" ALTER COLUMN "estado" DROP DEFAULT;
ALTER TABLE "EstadoConversa" ALTER COLUMN "estado" TYPE "EstadoConversaEnum_new" USING ("estado"::text::"EstadoConversaEnum_new");
ALTER TYPE "EstadoConversaEnum" RENAME TO "EstadoConversaEnum_old";
ALTER TYPE "EstadoConversaEnum_new" RENAME TO "EstadoConversaEnum";
DROP TYPE "public"."EstadoConversaEnum_old";
ALTER TABLE "EstadoConversa" ALTER COLUMN "estado" SET DEFAULT 'OCIOSO';
COMMIT;

-- AlterTable
ALTER TABLE "ItemCardapio" ADD COLUMN     "removidoEm" TIMESTAMP(3);

