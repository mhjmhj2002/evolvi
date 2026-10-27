-- CreateEnum
CREATE TYPE "TipoSuspeitaMovimento" AS ENUM ('SUSPEITA_DUPLICATA', 'SUSPEITA_APORTE', 'SUSPEITA_CATEGORIZACAO');

-- CreateEnum
CREATE TYPE "StatusSuspeitaMovimento" AS ENUM ('PENDENTE', 'RESOLVIDO', 'IGNORADO');

-- CreateTable
CREATE TABLE "suspeitas_movimento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "tipo" "TipoSuspeitaMovimento" NOT NULL,
    "status" "StatusSuspeitaMovimento" NOT NULL DEFAULT 'PENDENTE',
    "confianca" DECIMAL(5,4) NOT NULL,
    "motivo" TEXT NOT NULL,
    "movimento_id" UUID NOT NULL,
    "movimento_secundario_id" UUID,
    "sugestao_natureza" VARCHAR(50),
    "categoria_sugerida" VARCHAR(100),
    "acao_aplicada" VARCHAR(50),
    "resolvido_em" TIMESTAMPTZ(6),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suspeitas_movimento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_suspeitas_movimento_usuario_status" ON "suspeitas_movimento"("usuario_id", "status");

-- CreateIndex
CREATE INDEX "idx_suspeitas_movimento_principal" ON "suspeitas_movimento"("movimento_id");

-- CreateIndex
CREATE INDEX "idx_suspeitas_movimento_secundario" ON "suspeitas_movimento"("movimento_secundario_id");

-- AddForeignKey
ALTER TABLE "suspeitas_movimento" ADD CONSTRAINT "suspeitas_movimento_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suspeitas_movimento" ADD CONSTRAINT "suspeitas_movimento_movimento_id_fkey" FOREIGN KEY ("movimento_id") REFERENCES "movimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suspeitas_movimento" ADD CONSTRAINT "suspeitas_movimento_movimento_secundario_id_fkey" FOREIGN KEY ("movimento_secundario_id") REFERENCES "movimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
