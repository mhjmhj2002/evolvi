-- CreateTable
CREATE TABLE "configuracoes_ia_usuario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "provedor" VARCHAR(30) NOT NULL DEFAULT 'GEMINI',
    "modelo" VARCHAR(60) NOT NULL DEFAULT 'gemini-2.5-flash',
    "api_key_cifrada" TEXT NOT NULL,
    "iv_hex" VARCHAR(32) NOT NULL,
    "tag_hex" VARCHAR(40) NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configuracoes_ia_usuario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "configuracoes_ia_usuario_usuario_id_key" ON "configuracoes_ia_usuario"("usuario_id");

-- AddForeignKey
ALTER TABLE "configuracoes_ia_usuario" ADD CONSTRAINT "configuracoes_ia_usuario_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
