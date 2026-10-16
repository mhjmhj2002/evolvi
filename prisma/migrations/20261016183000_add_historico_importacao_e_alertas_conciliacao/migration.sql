-- CreateEnum
CREATE TYPE "tipo_documento_importado" AS ENUM ('FATURA_CARTAO', 'EXTRATO_CONTA_CORRENTE', 'EXTRATO_INVESTIMENTO', 'OUTRO');

-- CreateEnum
CREATE TYPE "tipo_alerta_conciliacao" AS ENUM ('FATURA_NAO_IMPORTADA', 'EXTRATO_LACUNA_TEMPORAL', 'CONFLITO_SALDO');

-- CreateEnum
CREATE TYPE "status_alerta_conciliacao" AS ENUM ('PENDENTE', 'RESOLVIDO', 'DISPENSADO');

-- AlterTable
ALTER TABLE "contas" ADD COLUMN "monitorar_conciliacao" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "historico_importacao_arquivos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "arquivo_id" UUID NOT NULL,
    "conta_id" UUID,
    "tipo_documento" "tipo_documento_importado" NOT NULL DEFAULT 'OUTRO',
    "instituicao" VARCHAR(100) NOT NULL,
    "competencia" VARCHAR(7) NOT NULL,
    "data_vencimento" DATE,
    "periodo_inicio" DATE,
    "periodo_fim" DATE,
    "total_transacoes" INTEGER NOT NULL DEFAULT 0,
    "valor_total" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historico_importacao_arquivos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alertas_conciliacao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "conta_id" UUID,
    "tipo_alerta" "tipo_alerta_conciliacao" NOT NULL,
    "titulo" VARCHAR(200) NOT NULL,
    "descricao" TEXT NOT NULL,
    "competencia" VARCHAR(7) NOT NULL,
    "status" "status_alerta_conciliacao" NOT NULL DEFAULT 'PENDENTE',
    "motivo_dispensa" VARCHAR(100),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvido_em" TIMESTAMPTZ(6),

    CONSTRAINT "alertas_conciliacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "historico_importacao_arquivos_arquivo_id_key" ON "historico_importacao_arquivos"("arquivo_id");

-- CreateIndex
CREATE INDEX "idx_historico_importacao_usuario_comp" ON "historico_importacao_arquivos"("usuario_id", "competencia");

-- CreateIndex
CREATE INDEX "idx_historico_importacao_usuario_conta" ON "historico_importacao_arquivos"("usuario_id", "conta_id");

-- CreateIndex
CREATE INDEX "idx_alertas_conciliacao_usuario_status" ON "alertas_conciliacao"("usuario_id", "status");

-- CreateIndex
CREATE INDEX "idx_alertas_conciliacao_usuario_conta_comp" ON "alertas_conciliacao"("usuario_id", "conta_id", "competencia");

-- AddForeignKey
ALTER TABLE "historico_importacao_arquivos" ADD CONSTRAINT "historico_importacao_arquivos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_importacao_arquivos" ADD CONSTRAINT "historico_importacao_arquivos_arquivo_id_fkey" FOREIGN KEY ("arquivo_id") REFERENCES "arquivos_importacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_importacao_arquivos" ADD CONSTRAINT "historico_importacao_arquivos_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alertas_conciliacao" ADD CONSTRAINT "alertas_conciliacao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alertas_conciliacao" ADD CONSTRAINT "alertas_conciliacao_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
