-- CreateTable
CREATE TABLE "regras_vendedor_categoria" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "termo_vendedor" VARCHAR(120) NOT NULL,
    "categoria_id" UUID NOT NULL,
    "total_aplicacoes" INTEGER NOT NULL DEFAULT 1,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regras_vendedor_categoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_regras_vendedor_usuario" ON "regras_vendedor_categoria"("usuario_id");

-- CreateIndex
CREATE INDEX "idx_regras_vendedor_categoria" ON "regras_vendedor_categoria"("categoria_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_regras_vendedor_usuario_termo" ON "regras_vendedor_categoria"("usuario_id", "termo_vendedor");

-- AddForeignKey
ALTER TABLE "regras_vendedor_categoria" ADD CONSTRAINT "regras_vendedor_categoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regras_vendedor_categoria" ADD CONSTRAINT "regras_vendedor_categoria_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE CASCADE ON UPDATE CASCADE;
