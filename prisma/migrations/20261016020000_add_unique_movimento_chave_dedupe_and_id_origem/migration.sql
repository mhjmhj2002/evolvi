-- AlterTable
ALTER TABLE "movimentos" ADD COLUMN IF NOT EXISTS "id_origem" VARCHAR(255);

-- AlterTable
ALTER TABLE "staging_lancamentos_importacao" ADD COLUMN IF NOT EXISTS "id_origem" VARCHAR(255);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_movimentos_usuario_chave_dedupe" ON "movimentos"("usuario_id", "chave_dedupe");
