-- DropIndex
DROP INDEX IF EXISTS "configuracoes_ia_usuario_usuario_id_key";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_configuracao_ia_usuario" ON "configuracoes_ia_usuario"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_configuracao_ia_usuario_provedor" ON "configuracoes_ia_usuario"("usuario_id", "provedor");
