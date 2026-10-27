-- CreateTable
CREATE TABLE "regras_exclusao_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "categoria_id" UUID,
    "descricao_padrao" VARCHAR(255),
    "valor_minimo" DECIMAL(12,2),
    "apenas_uma_vez" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "motivo" VARCHAR(255),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regras_exclusao_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exclusoes_movimento_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "movimento_id" UUID NOT NULL,
    "motivo" VARCHAR(255) NOT NULL,
    "origem" VARCHAR(30) NOT NULL DEFAULT 'AUTOMATICA',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exclusoes_movimento_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medias_mensais_consolidadas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "categoria_id" UUID,
    "competencia_referencia" VARCHAR(7) NOT NULL,
    "meses_janela" INTEGER NOT NULL DEFAULT 6,
    "total_periodo_bruto" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "total_excluido" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "total_periodo_efetivo" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "media_mensal_efetiva" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "qtd_lancamentos_totais" INTEGER NOT NULL DEFAULT 0,
    "qtd_lancamentos_excluidos" INTEGER NOT NULL DEFAULT 0,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medias_mensais_consolidadas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_regras_exclusao_media_usuario_ativo" ON "regras_exclusao_media"("usuario_id", "ativo");

-- CreateIndex
CREATE INDEX "idx_exclusoes_movimento_media_usuario_ativo" ON "exclusoes_movimento_media"("usuario_id", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "uq_exclusoes_movimento_media_usuario_movimento" ON "exclusoes_movimento_media"("usuario_id", "movimento_id");

-- CreateIndex
CREATE INDEX "idx_media_mensal_consolidada_usuario_comp" ON "medias_mensais_consolidadas"("usuario_id", "competencia_referencia");

-- CreateIndex
CREATE UNIQUE INDEX "uq_media_mensal_consolidada_chave" ON "medias_mensais_consolidadas"("usuario_id", "categoria_id", "competencia_referencia", "meses_janela");

-- AddForeignKey
ALTER TABLE "regras_exclusao_media" ADD CONSTRAINT "regras_exclusao_media_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regras_exclusao_media" ADD CONSTRAINT "regras_exclusao_media_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exclusoes_movimento_media" ADD CONSTRAINT "exclusoes_movimento_media_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exclusoes_movimento_media" ADD CONSTRAINT "exclusoes_movimento_media_movimento_id_fkey" FOREIGN KEY ("movimento_id") REFERENCES "movimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medias_mensais_consolidadas" ADD CONSTRAINT "medias_mensais_consolidadas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medias_mensais_consolidadas" ADD CONSTRAINT "medias_mensais_consolidadas_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE SET NULL ON UPDATE CASCADE;
