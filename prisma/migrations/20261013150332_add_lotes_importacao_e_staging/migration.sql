-- CreateEnum
CREATE TYPE "status_lote_importacao" AS ENUM ('RECEPCIONADO', 'PROCESSANDO_IA', 'CARGA_STAGING', 'CONSOLIDANDO', 'CONCLUIDO', 'ERRO_PARCIAL', 'ERRO_TOTAL');

-- CreateEnum
CREATE TYPE "status_arquivo_importacao" AS ENUM ('RECEPCIONADO', 'ENVIADO_IA', 'IA_CONCLUIDO', 'STAGING_CARREGADO', 'PROCESSADO_FINAL', 'ERRO');

-- CreateEnum
CREATE TYPE "status_staging_lancamento" AS ENUM ('PENDENTE', 'PROCESSADO', 'IGNORADO', 'ERRO');

-- CreateTable
CREATE TABLE "lotes_importacao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "caminho_diretorio" VARCHAR(500) NOT NULL,
    "total_arquivos" INTEGER NOT NULL DEFAULT 0,
    "arquivos_processados" INTEGER NOT NULL DEFAULT 0,
    "status" "status_lote_importacao" NOT NULL DEFAULT 'RECEPCIONADO',
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lotes_importacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arquivos_importacao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lote_id" UUID NOT NULL,
    "nome_arquivo" VARCHAR(255) NOT NULL,
    "tamanho_bytes" BIGINT NOT NULL DEFAULT 0,
    "mime_type" VARCHAR(100),
    "caminho_relativo" VARCHAR(500) NOT NULL,
    "status" "status_arquivo_importacao" NOT NULL DEFAULT 'RECEPCIONADO',
    "mensagem_erro" TEXT,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arquivos_importacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staging_lancamentos_importacao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lote_id" UUID NOT NULL,
    "arquivo_id" UUID NOT NULL,
    "arquivo_origem" VARCHAR(255) NOT NULL,
    "data_movimento" DATE NOT NULL,
    "descricao" VARCHAR(255) NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "natureza" "natureza_movimento" NOT NULL,
    "conta_sugerida" VARCHAR(100),
    "tipo_conta" "tipo_conta",
    "categoria_sugerida" VARCHAR(100),
    "parcela_atual" INTEGER,
    "total_parcelas" INTEGER,
    "observacao" TEXT,
    "status_processamento" "status_staging_lancamento" NOT NULL DEFAULT 'PENDENTE',
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staging_lancamentos_importacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_lotes_usuario_status" ON "lotes_importacao"("usuario_id", "status");

-- CreateIndex
CREATE INDEX "idx_arquivos_lote_status" ON "arquivos_importacao"("lote_id", "status");

-- CreateIndex
CREATE INDEX "idx_staging_lote_status" ON "staging_lancamentos_importacao"("lote_id", "status_processamento");

-- CreateIndex
CREATE INDEX "idx_staging_arquivo" ON "staging_lancamentos_importacao"("arquivo_id");

-- AddForeignKey
ALTER TABLE "lotes_importacao" ADD CONSTRAINT "lotes_importacao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arquivos_importacao" ADD CONSTRAINT "arquivos_importacao_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes_importacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staging_lancamentos_importacao" ADD CONSTRAINT "staging_lancamentos_importacao_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes_importacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staging_lancamentos_importacao" ADD CONSTRAINT "staging_lancamentos_importacao_arquivo_id_fkey" FOREIGN KEY ("arquivo_id") REFERENCES "arquivos_importacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
