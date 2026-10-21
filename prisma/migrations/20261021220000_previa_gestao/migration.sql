-- CreateTable
CREATE TABLE "PreviaGestao" (
    "id" TEXT NOT NULL,
    "dados" JSONB NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreviaGestao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PreviaGestao_expiraEm_idx" ON "PreviaGestao"("expiraEm");

