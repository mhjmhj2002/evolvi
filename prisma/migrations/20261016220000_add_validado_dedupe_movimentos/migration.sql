-- AlterTable
ALTER TABLE "movimentos" ADD COLUMN "validado_dedupe" VARCHAR(1) NOT NULL DEFAULT 'N';

-- CreateIndex
CREATE INDEX "idx_movimentos_usuario_validado_dedupe" ON "movimentos"("usuario_id", "validado_dedupe");
