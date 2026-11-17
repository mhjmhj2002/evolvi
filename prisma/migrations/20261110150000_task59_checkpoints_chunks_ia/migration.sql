CREATE TABLE "checkpoints_chunks_ia" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "arquivo_id" UUID NOT NULL,
    "indice" INTEGER NOT NULL,
    "hash_conteudo" VARCHAR(64) NOT NULL,
    "hash_contexto" VARCHAR(64) NOT NULL,
    "provedor" VARCHAR(30) NOT NULL,
    "modelo" VARCHAR(100) NOT NULL,
    "versao_prompt" VARCHAR(40) NOT NULL,
    "versao_schema" VARCHAR(40) NOT NULL,
    "resultado" JSONB NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "checkpoints_chunks_ia_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "checkpoints_chunks_ia_arquivo_id_fkey" FOREIGN KEY ("arquivo_id") REFERENCES "arquivos_importacao"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "uq_checkpoint_chunk_arquivo_indice" ON "checkpoints_chunks_ia"("arquivo_id", "indice");
CREATE INDEX "idx_checkpoint_chunk_usuario_arquivo" ON "checkpoints_chunks_ia"("usuario_id", "arquivo_id");
