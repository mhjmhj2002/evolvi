-- CreateTable
CREATE TABLE IF NOT EXISTS "movimentos_rateio" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "movimento_id" UUID NOT NULL,
    "categoria_id" UUID NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "descricao" VARCHAR(255),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentos_rateio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_movimentos_rateio_movimento" ON "movimentos_rateio"("movimento_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_movimentos_rateio_categoria" ON "movimentos_rateio"("categoria_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'movimentos_rateio_movimento_id_fkey'
    ) THEN
        ALTER TABLE "movimentos_rateio" ADD CONSTRAINT "movimentos_rateio_movimento_id_fkey" FOREIGN KEY ("movimento_id") REFERENCES "movimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'movimentos_rateio_categoria_id_fkey'
    ) THEN
        ALTER TABLE "movimentos_rateio" ADD CONSTRAINT "movimentos_rateio_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
