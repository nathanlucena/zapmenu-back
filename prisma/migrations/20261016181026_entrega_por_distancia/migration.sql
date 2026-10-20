-- AlterTable
ALTER TABLE "Loja" ADD COLUMN     "bairro" TEXT,
ADD COLUMN     "cep" TEXT,
ADD COLUMN     "cidade" TEXT,
ADD COLUMN     "complemento" TEXT,
ADD COLUMN     "faixasEntrega" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "logradouro" TEXT,
ADD COLUMN     "longitude" DECIMAL(9,6),
ADD COLUMN     "numero" TEXT,
ADD COLUMN     "precisaoEndereco" TEXT,
ADD COLUMN     "uf" CHAR(2);
