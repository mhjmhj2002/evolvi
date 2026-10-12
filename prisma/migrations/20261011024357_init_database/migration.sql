-- CreateEnum
CREATE TYPE "tipo_conta" AS ENUM ('CONTA_CORRENTE', 'CARTAO_CREDITO', 'INVESTIMENTO', 'CARTEIRA_DINHEIRO');

-- CreateEnum
CREATE TYPE "natureza_movimento" AS ENUM ('RECEITA', 'DESPESA', 'TRANSFERENCIA_PROPRIA', 'APORTE_PATRIMONIAL');

-- CreateEnum
CREATE TYPE "status_movimento" AS ENUM ('PREVISTO', 'CONCILIADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "status_parcelamento" AS ENUM ('ATIVO', 'QUITADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "status_recorrencia" AS ENUM ('ATIVA', 'PAUSADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "semaforo_status" AS ENUM ('VERDE', 'AMARELO', 'VERMELHO');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" VARCHAR(120) NOT NULL,
    "email" VARCHAR(180) NOT NULL,
    "senha_hash" VARCHAR(255) NOT NULL,
    "renda_base_mensal" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "fase_atual" INTEGER NOT NULL DEFAULT 1,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "tipo" "tipo_conta" NOT NULL,
    "dia_fechamento" INTEGER,
    "dia_vencimento" INTEGER,
    "saldo_inicial" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID,
    "nome" VARCHAR(80) NOT NULL,
    "descricao" VARCHAR(255),
    "categoria_pai_id" UUID,
    "peso_bruto_referencia" DECIMAL(6,4) DEFAULT 0.0000,
    "referencia_normalizada_pct" DECIMAL(5,2) DEFAULT 0.00,
    "ordem" INTEGER DEFAULT 0,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "conta_id" UUID NOT NULL,
    "categoria_id" UUID,
    "data_movimento" DATE NOT NULL,
    "competencia" VARCHAR(7) NOT NULL,
    "descricao" VARCHAR(255) NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "natureza" "natureza_movimento" NOT NULL,
    "status" "status_movimento" NOT NULL DEFAULT 'CONCILIADO',
    "chave_dedupe" VARCHAR(255),
    "transferencia_vinculo_id" UUID,
    "observacao" TEXT,
    "origem_documento" VARCHAR(255),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recorrencias" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "categoria_id" UUID,
    "descricao" VARCHAR(150) NOT NULL,
    "valor_referencia" DECIMAL(12,2) NOT NULL,
    "dia_previsto" INTEGER,
    "forma_pagamento" VARCHAR(50),
    "essencial" BOOLEAN NOT NULL DEFAULT true,
    "status" "status_recorrencia" NOT NULL DEFAULT 'ATIVA',
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recorrencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcelamentos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "conta_id" UUID,
    "categoria_id" UUID,
    "descricao" VARCHAR(150) NOT NULL,
    "valor_total" DECIMAL(12,2) NOT NULL,
    "parcela_valor" DECIMAL(12,2) NOT NULL,
    "parcela_atual" INTEGER NOT NULL,
    "total_parcelas" INTEGER NOT NULL,
    "primeiro_vencimento" VARCHAR(7) NOT NULL,
    "ultimo_vencimento" VARCHAR(7) NOT NULL,
    "status" "status_parcelamento" NOT NULL DEFAULT 'ATIVO',
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parcelamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metas_zero_a_zero" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "categoria_id" UUID NOT NULL,
    "competencia" VARCHAR(7) NOT NULL,
    "baseline_mensal" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "meta_proposta" DECIMAL(12,2) NOT NULL,
    "reducao_proposta" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "condicao_acao" TEXT,
    "status_semaforo" "semaforo_status" NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metas_zero_a_zero_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE INDEX "idx_contas_usuario" ON "contas"("usuario_id");

-- CreateIndex
CREATE INDEX "idx_categorias_usuario" ON "categorias"("usuario_id");

-- CreateIndex
CREATE INDEX "idx_movimentos_usuario_competencia" ON "movimentos"("usuario_id", "competencia");

-- CreateIndex
CREATE INDEX "idx_movimentos_chave_dedupe" ON "movimentos"("chave_dedupe");

-- CreateIndex
CREATE INDEX "idx_movimentos_categoria" ON "movimentos"("categoria_id");

-- CreateIndex
CREATE INDEX "idx_recorrencias_usuario" ON "recorrencias"("usuario_id");

-- CreateIndex
CREATE INDEX "idx_parcelamentos_usuario" ON "parcelamentos"("usuario_id");

-- CreateIndex
CREATE INDEX "idx_metas_usuario_comp" ON "metas_zero_a_zero"("usuario_id", "competencia");

-- CreateIndex
CREATE UNIQUE INDEX "uq_meta_usuario_categoria_competencia" ON "metas_zero_a_zero"("usuario_id", "categoria_id", "competencia");

-- AddForeignKey
ALTER TABLE "contas" ADD CONSTRAINT "contas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_categoria_pai_id_fkey" FOREIGN KEY ("categoria_pai_id") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos" ADD CONSTRAINT "movimentos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos" ADD CONSTRAINT "movimentos_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos" ADD CONSTRAINT "movimentos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos" ADD CONSTRAINT "movimentos_transferencia_vinculo_id_fkey" FOREIGN KEY ("transferencia_vinculo_id") REFERENCES "movimentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recorrencias" ADD CONSTRAINT "recorrencias_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recorrencias" ADD CONSTRAINT "recorrencias_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcelamentos" ADD CONSTRAINT "parcelamentos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcelamentos" ADD CONSTRAINT "parcelamentos_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcelamentos" ADD CONSTRAINT "parcelamentos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metas_zero_a_zero" ADD CONSTRAINT "metas_zero_a_zero_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metas_zero_a_zero" ADD CONSTRAINT "metas_zero_a_zero_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
