CREATE TYPE "tipo_documento_rastreavel" AS ENUM ('FATURA_CARTAO', 'EXTRATO_CONTA');
CREATE TYPE "status_conciliacao_fatura" AS ENUM ('PENDENTE', 'OK', 'DIVERGENTE', 'REJEITADA');

CREATE TABLE "instituicoes_financeiras" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "nome_oficial" VARCHAR(180) NOT NULL,
  "nome_reduzido" VARCHAR(80) NOT NULL, "codigo_compe" VARCHAR(3), "ispb" VARCHAR(8) NOT NULL,
  "cnpj" VARCHAR(14), "tipo" VARCHAR(40) NOT NULL, "aliases" JSONB NOT NULL DEFAULT '[]',
  "ativo" BOOLEAN NOT NULL DEFAULT true, "fonte_catalogo" VARCHAR(255) NOT NULL,
  "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "instituicoes_financeiras_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "instituicoes_financeiras_codigo_compe_key" ON "instituicoes_financeiras"("codigo_compe");
CREATE UNIQUE INDEX "instituicoes_financeiras_ispb_key" ON "instituicoes_financeiras"("ispb");
CREATE TABLE "faturas" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "usuario_id" UUID NOT NULL, "instituicao_id" UUID NOT NULL,
  "id_fatura" VARCHAR(128) NOT NULL, "hash_arquivo" VARCHAR(64) NOT NULL, "nome_arquivo_original" VARCHAR(255) NOT NULL,
  "tipo_documento" "tipo_documento_rastreavel" NOT NULL, "ano_mes_fatura" VARCHAR(7) NOT NULL,
  "periodo_inicio" DATE, "periodo_fim" DATE, "data_fechamento" DATE, "data_vencimento" DATE, "conta_id" UUID,
  "valor_total_documento" DECIMAL(12,2), "valor_total_lancamentos" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "quantidade_lancamentos_documento" INTEGER, "quantidade_lancamentos_importados" INTEGER NOT NULL DEFAULT 0,
  "status_conciliacao" "status_conciliacao_fatura" NOT NULL DEFAULT 'PENDENTE', "metadados_extracao" JSONB NOT NULL DEFAULT '{}',
  "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "faturas_pkey" PRIMARY KEY ("id"), CONSTRAINT "faturas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE,
  CONSTRAINT "faturas_instituicao_id_fkey" FOREIGN KEY ("instituicao_id") REFERENCES "instituicoes_financeiras"("id") ON DELETE RESTRICT,
  CONSTRAINT "faturas_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "uq_faturas_usuario_hash" ON "faturas"("usuario_id", "hash_arquivo");
CREATE UNIQUE INDEX "uq_faturas_usuario_id_fatura" ON "faturas"("usuario_id", "id_fatura");
ALTER TABLE "movimentos" ADD COLUMN "fatura_id" UUID, ADD COLUMN "data_compra" DATE, ADD COLUMN "competencia_contabil" VARCHAR(7), ADD COLUMN "competencia_fatura" VARCHAR(7);
ALTER TABLE "movimentos" ADD CONSTRAINT "movimentos_fatura_id_fkey" FOREIGN KEY ("fatura_id") REFERENCES "faturas"("id") ON DELETE RESTRICT;
CREATE INDEX "idx_movimentos_usuario_fatura" ON "movimentos"("usuario_id", "fatura_id");
