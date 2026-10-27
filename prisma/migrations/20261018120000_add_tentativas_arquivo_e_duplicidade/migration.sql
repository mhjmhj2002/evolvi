-- TASK-50: Gestão de Importação — Lote → Arquivo → Detalhe (tentativas e alerta de duplicidade)

-- CreateEnum
CREATE TYPE "origem_lote_importacao" AS ENUM ('UPLOAD', 'PASTA');

-- CreateEnum
CREATE TYPE "status_tentativa_arquivo_importacao" AS ENUM ('SUCESSO', 'FALHA', 'DUPLICADO');

-- AlterTable: lotes_importacao (contadores e ciclo de vida)
ALTER TABLE "lotes_importacao"
  ADD COLUMN "origem" "origem_lote_importacao" NOT NULL DEFAULT 'UPLOAD',
  ADD COLUMN "ia_selecionada" VARCHAR(80),
  ADD COLUMN "total_sucesso" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "total_falha" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "total_duplicados" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "total_lancamentos" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "iniciado_em" TIMESTAMPTZ(6),
  ADD COLUMN "finalizado_em" TIMESTAMPTZ(6);

-- AlterTable: arquivos_importacao (hash, tentativas, duplicidade, reenvio)
ALTER TABLE "arquivos_importacao"
  ADD COLUMN "usuario_id" UUID,
  ADD COLUMN "hash_conteudo" VARCHAR(64),
  ADD COLUMN "total_tentativas" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "status_final" VARCHAR(30),
  ADD COLUMN "ja_importado_anteriormente" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "arquivo_original_id" UUID,
  ADD COLUMN "ultimo_provedor" VARCHAR(30);

-- Backfill: desnormaliza o dono do lote nos arquivos já existentes
UPDATE "arquivos_importacao" ai
SET "usuario_id" = li."usuario_id"
FROM "lotes_importacao" li
WHERE ai."lote_id" = li."id" AND ai."usuario_id" IS NULL;

-- CreateTable: tentativas_arquivo_importacao
CREATE TABLE "tentativas_arquivo_importacao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "arquivo_id" UUID NOT NULL,
    "numero_tentativa" INTEGER NOT NULL,
    "provedor" VARCHAR(30) NOT NULL,
    "modelo" VARCHAR(80) NOT NULL,
    "status" "status_tentativa_arquivo_importacao" NOT NULL,
    "mensagem_erro" TEXT,
    "total_transacoes_extraidas" INTEGER NOT NULL DEFAULT 0,
    "duracao_ms" INTEGER NOT NULL DEFAULT 0,
    "uso_ia_log_id" UUID,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tentativas_arquivo_importacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_tentativas_usuario_arquivo_numero" ON "tentativas_arquivo_importacao"("usuario_id", "arquivo_id", "numero_tentativa");
CREATE INDEX "idx_tentativas_usuario_arquivo_criado" ON "tentativas_arquivo_importacao"("usuario_id", "arquivo_id", "criado_em");
CREATE INDEX "idx_tentativas_usuario_status" ON "tentativas_arquivo_importacao"("usuario_id", "status");

-- CreateIndex: buscas de duplicidade por hash e por nome (isoladas por usuário)
CREATE INDEX "idx_arquivos_usuario_hash" ON "arquivos_importacao"("usuario_id", "hash_conteudo");
CREATE INDEX "idx_arquivos_usuario_nome" ON "arquivos_importacao"("usuario_id", "nome_arquivo");
CREATE INDEX "idx_arquivos_original" ON "arquivos_importacao"("arquivo_original_id");

-- AddForeignKey
ALTER TABLE "arquivos_importacao" ADD CONSTRAINT "arquivos_importacao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "arquivos_importacao" ADD CONSTRAINT "arquivos_importacao_arquivo_original_id_fkey" FOREIGN KEY ("arquivo_original_id") REFERENCES "arquivos_importacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tentativas_arquivo_importacao" ADD CONSTRAINT "tentativas_arquivo_importacao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tentativas_arquivo_importacao" ADD CONSTRAINT "tentativas_arquivo_importacao_arquivo_id_fkey" FOREIGN KEY ("arquivo_id") REFERENCES "arquivos_importacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
