-- AlterTable
ALTER TABLE "movimentos" ADD COLUMN "categoria_fixada_usuario" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "idx_movimentos_usuario_fixada" ON "movimentos"("usuario_id", "categoria_fixada_usuario");
