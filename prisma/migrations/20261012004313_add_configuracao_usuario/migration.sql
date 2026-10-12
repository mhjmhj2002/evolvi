-- CreateTable
CREATE TABLE "configuracoes_usuario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "meses_janela_temporal" INTEGER NOT NULL DEFAULT 6,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configuracoes_usuario_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_configuracoes_meses_janela" CHECK ("meses_janela_temporal" >= 3 AND "meses_janela_temporal" <= 12)
);

-- CreateIndex
CREATE UNIQUE INDEX "configuracoes_usuario_usuario_id_key" ON "configuracoes_usuario"("usuario_id");

-- AddForeignKey
ALTER TABLE "configuracoes_usuario" ADD CONSTRAINT "configuracoes_usuario_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
