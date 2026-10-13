-- CreateEnum
CREATE TYPE "tipo_dado_bruto" AS ENUM ('TRANSACOES', 'FATURAS', 'CONTAS', 'SALDOS');

-- CreateEnum
CREATE TYPE "status_dado_bruto" AS ENUM ('PENDENTE_PROCESSAMENTO', 'PROCESSANDO', 'PROCESSADO', 'ERRO_PROCESSAMENTO');

-- AlterTable
ALTER TABLE "configuracoes_usuario" ADD COLUMN     "intervalo_sincronizacao_horas" INTEGER NOT NULL DEFAULT 6;
ALTER TABLE "configuracoes_usuario" ADD CONSTRAINT "chk_configuracoes_intervalo_sync" CHECK ("intervalo_sincronizacao_horas" >= 1 AND "intervalo_sincronizacao_horas" <= 48);

-- CreateTable
CREATE TABLE "dados_brutos_open_finance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "conexao_id" UUID NOT NULL,
    "instituicao_codigo" VARCHAR(20) NOT NULL,
    "tipo_dado" "tipo_dado_bruto" NOT NULL,
    "payload_raw" JSONB NOT NULL,
    "hash_carga" VARCHAR(64) NOT NULL,
    "status" "status_dado_bruto" NOT NULL DEFAULT 'PENDENTE_PROCESSAMENTO',
    "mensagem_erro" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "coletado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processado_em" TIMESTAMPTZ(6),

    CONSTRAINT "dados_brutos_open_finance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_dados_brutos_usuario_status" ON "dados_brutos_open_finance"("usuario_id", "status");

-- CreateIndex
CREATE INDEX "idx_dados_brutos_conexao_coletado" ON "dados_brutos_open_finance"("conexao_id", "coletado_em");

-- CreateIndex
CREATE UNIQUE INDEX "uq_dados_brutos_conexao_hash" ON "dados_brutos_open_finance"("conexao_id", "hash_carga");

-- AddForeignKey
ALTER TABLE "dados_brutos_open_finance" ADD CONSTRAINT "dados_brutos_open_finance_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dados_brutos_open_finance" ADD CONSTRAINT "dados_brutos_open_finance_conexao_id_fkey" FOREIGN KEY ("conexao_id") REFERENCES "conexoes_bancarias"("id") ON DELETE CASCADE ON UPDATE CASCADE;
