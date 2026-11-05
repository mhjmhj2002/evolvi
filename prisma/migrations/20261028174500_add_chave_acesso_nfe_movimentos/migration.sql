-- AlterTable
ALTER TABLE "movimentos" ADD COLUMN     "chave_acesso_nfe" VARCHAR(44);

-- CreateIndex
CREATE INDEX "idx_movimentos_usuario_chave_acesso_nfe" ON "movimentos"("usuario_id", "chave_acesso_nfe");
