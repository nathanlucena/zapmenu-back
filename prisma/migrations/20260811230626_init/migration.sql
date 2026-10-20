-- CreateEnum
CREATE TYPE "StatusPedido" AS ENUM ('AGUARDANDO_CONFIRMACAO', 'AGUARDANDO_PAGAMENTO', 'PAGO', 'EXPIRADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "StatusPagamento" AS ENUM ('PENDENTE', 'APROVADO', 'REJEITADO', 'EXPIRADO');

-- CreateEnum
CREATE TYPE "EstadoConversaEnum" AS ENUM ('OCIOSO', 'AGUARDANDO_ITEM', 'AGUARDANDO_APROVACAO', 'EDITANDO');

-- CreateTable
CREATE TABLE "Empreendedor" (
    "id" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Empreendedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cardapio" (
    "id" TEXT NOT NULL,
    "empreendedorId" TEXT NOT NULL,
    "publicadoEm" TIMESTAMP(3),

    CONSTRAINT "Cardapio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemCardapio" (
    "id" TEXT NOT NULL,
    "cardapioId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "precoBase" DECIMAL(10,2) NOT NULL,
    "imagemUrl" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemCardapio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variacao" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "opcoes" JSONB NOT NULL,

    CONSTRAINT "Variacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pedido" (
    "id" TEXT NOT NULL,
    "codigoCurto" TEXT NOT NULL,
    "empreendedorId" TEXT NOT NULL,
    "telefoneCliente" TEXT,
    "status" "StatusPedido" NOT NULL DEFAULT 'AGUARDANDO_CONFIRMACAO',
    "valorTotal" DECIMAL(10,2) NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmadoEm" TIMESTAMP(3),

    CONSTRAINT "Pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemPedido" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "itemCardapioId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "variacaoEscolhida" JSONB,
    "precoUnitario" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "ItemPedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pagamento" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "provedor" TEXT NOT NULL DEFAULT 'mercado_pago',
    "idTransacaoExterno" TEXT NOT NULL,
    "status" "StatusPagamento" NOT NULL DEFAULT 'PENDENTE',
    "qrCodeBase64" TEXT,
    "copiaCola" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmadoEm" TIMESTAMP(3),

    CONSTRAINT "Pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstadoConversa" (
    "id" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "empreendedorId" TEXT,
    "estado" "EstadoConversaEnum" NOT NULL DEFAULT 'OCIOSO',
    "contexto" JSONB NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstadoConversa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoProcessado" (
    "id" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "chaveExterna" TEXT NOT NULL,
    "processadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoProcessado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Empreendedor_telefone_key" ON "Empreendedor"("telefone");

-- CreateIndex
CREATE UNIQUE INDEX "Cardapio_empreendedorId_key" ON "Cardapio"("empreendedorId");

-- CreateIndex
CREATE INDEX "ItemCardapio_cardapioId_idx" ON "ItemCardapio"("cardapioId");

-- CreateIndex
CREATE INDEX "Variacao_itemId_idx" ON "Variacao"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Pedido_codigoCurto_key" ON "Pedido"("codigoCurto");

-- CreateIndex
CREATE INDEX "Pedido_empreendedorId_idx" ON "Pedido"("empreendedorId");

-- CreateIndex
CREATE INDEX "Pedido_status_expiraEm_idx" ON "Pedido"("status", "expiraEm");

-- CreateIndex
CREATE INDEX "ItemPedido_pedidoId_idx" ON "ItemPedido"("pedidoId");

-- CreateIndex
CREATE UNIQUE INDEX "Pagamento_pedidoId_key" ON "Pagamento"("pedidoId");

-- CreateIndex
CREATE UNIQUE INDEX "Pagamento_idTransacaoExterno_key" ON "Pagamento"("idTransacaoExterno");

-- CreateIndex
CREATE UNIQUE INDEX "EstadoConversa_telefone_key" ON "EstadoConversa"("telefone");

-- CreateIndex
CREATE UNIQUE INDEX "EventoProcessado_origem_chaveExterna_key" ON "EventoProcessado"("origem", "chaveExterna");

-- AddForeignKey
ALTER TABLE "Cardapio" ADD CONSTRAINT "Cardapio_empreendedorId_fkey" FOREIGN KEY ("empreendedorId") REFERENCES "Empreendedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCardapio" ADD CONSTRAINT "ItemCardapio_cardapioId_fkey" FOREIGN KEY ("cardapioId") REFERENCES "Cardapio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variacao" ADD CONSTRAINT "Variacao_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ItemCardapio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_empreendedorId_fkey" FOREIGN KEY ("empreendedorId") REFERENCES "Empreendedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPedido" ADD CONSTRAINT "ItemPedido_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPedido" ADD CONSTRAINT "ItemPedido_itemCardapioId_fkey" FOREIGN KEY ("itemCardapioId") REFERENCES "ItemCardapio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pagamento" ADD CONSTRAINT "Pagamento_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstadoConversa" ADD CONSTRAINT "EstadoConversa_empreendedorId_fkey" FOREIGN KEY ("empreendedorId") REFERENCES "Empreendedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
