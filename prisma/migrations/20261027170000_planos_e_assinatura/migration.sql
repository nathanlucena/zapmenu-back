-- CreateEnum
CREATE TYPE "PlanoAssinatura" AS ENUM ('ESSENCIAL', 'PROFISSIONAL');

-- CreateEnum
CREATE TYPE "PeriodoAssinatura" AS ENUM ('MENSAL', 'ANUAL');

-- CreateEnum
CREATE TYPE "StatusAssinatura" AS ENUM ('TESTE', 'ATIVA', 'PENDENTE', 'SUSPENSA', 'CANCELADA');

-- CreateTable
CREATE TABLE "Assinatura" (
    "id" TEXT NOT NULL,
    "empreendedorId" TEXT NOT NULL,
    "plano" "PlanoAssinatura" NOT NULL,
    "periodo" "PeriodoAssinatura" NOT NULL DEFAULT 'MENSAL',
    "status" "StatusAssinatura" NOT NULL,
    "mpPreapprovalId" TEXT,
    "emailCobranca" TEXT,
    "fimTeste" TIMESTAMP(3),
    "proximaCobranca" TIMESTAMP(3),
    "canceladaEm" TIMESTAMP(3),
    "planoProximoCiclo" "PlanoAssinatura",
    "pendenteDesde" TIMESTAMP(3),
    "avisoTesteDia" INTEGER,
    "avisoCobrancaDia" TEXT,
    "avisoPedidos80Mes" TEXT,
    "avisoPedidos100Mes" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assinatura_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Assinatura_empreendedorId_key" ON "Assinatura"("empreendedorId");

-- CreateIndex
CREATE UNIQUE INDEX "Assinatura_mpPreapprovalId_key" ON "Assinatura"("mpPreapprovalId");

-- CreateIndex
CREATE INDEX "Assinatura_status_idx" ON "Assinatura"("status");

-- AddForeignKey
ALTER TABLE "Assinatura" ADD CONSTRAINT "Assinatura_empreendedorId_fkey" FOREIGN KEY ("empreendedorId") REFERENCES "Empreendedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Lojas que já existiam começam um teste de 14 dias no Profissional a partir de agora.
INSERT INTO "Assinatura" ("id", "empreendedorId", "plano", "periodo", "status", "fimTeste", "atualizadoEm")
SELECT 'ass_' || "id", "id", 'PROFISSIONAL', 'MENSAL', 'TESTE', CURRENT_TIMESTAMP + INTERVAL '14 days', CURRENT_TIMESTAMP
FROM "Empreendedor";
