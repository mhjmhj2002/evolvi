-- CreateEnum
CREATE TYPE "funcionalidade_uso_ia" AS ENUM ('EXTRACAO_EXTRATO', 'CATEGORIZACAO', 'RECLASSIFICACAO', 'CHAT', 'OUTROS');

-- CreateEnum
CREATE TYPE "status_uso_ia" AS ENUM ('SUCESSO', 'FALHA');

-- CreateTable
CREATE TABLE "uso_ia_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "funcionalidade" "funcionalidade_uso_ia" NOT NULL,
    "provedor" VARCHAR(30) NOT NULL,
    "modelo" VARCHAR(80) NOT NULL,
    "tokens_prompt" INTEGER NOT NULL DEFAULT 0,
    "tokens_resposta" INTEGER NOT NULL DEFAULT 0,
    "tokens_total" INTEGER NOT NULL DEFAULT 0,
    "custo_usd" DECIMAL(12,6),
    "custo_brl" DECIMAL(12,6),
    "cotacao_usd_brl" DECIMAL(8,4),
    "duracao_ms" INTEGER NOT NULL DEFAULT 0,
    "status" "status_uso_ia" NOT NULL DEFAULT 'SUCESSO',
    "mensagem_erro" TEXT,
    "lote_id" UUID,
    "arquivo_id" UUID,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uso_ia_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_uso_ia_usuario_criado" ON "uso_ia_logs"("usuario_id", "criado_em");

-- CreateIndex
CREATE INDEX "idx_uso_ia_usuario_funcionalidade" ON "uso_ia_logs"("usuario_id", "funcionalidade");

-- CreateIndex
CREATE INDEX "idx_uso_ia_usuario_provedor" ON "uso_ia_logs"("usuario_id", "provedor");

-- AddForeignKey
ALTER TABLE "uso_ia_logs" ADD CONSTRAINT "uso_ia_logs_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
