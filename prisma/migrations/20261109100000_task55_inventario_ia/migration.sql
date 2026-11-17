CREATE TABLE "inventarios_ia_arquivo" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "usuario_id" UUID NOT NULL,
  "arquivo_id" UUID NOT NULL, "tentativa_id" UUID, "provedor" VARCHAR(30) NOT NULL,
  "modelo" VARCHAR(80) NOT NULL, "paginas_totais" INTEGER,
  "paginas_com_movimentos" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "registros_por_pagina" JSONB NOT NULL, "quantidade_esperada" INTEGER,
  "data_inicial" DATE, "data_final" DATE, "soma_absoluta_esperada" DECIMAL(14,2),
  "tipo_documento" VARCHAR(30) NOT NULL, "confianca" DECIMAL(4,3) NOT NULL,
  "observacoes" TEXT, "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
  "divergencias" JSONB, "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventarios_ia_arquivo_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventarios_ia_arquivo_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE,
  CONSTRAINT "inventarios_ia_arquivo_arquivo_id_fkey" FOREIGN KEY ("arquivo_id") REFERENCES "arquivos_importacao"("id") ON DELETE CASCADE,
  CONSTRAINT "inventarios_ia_arquivo_tentativa_id_fkey" FOREIGN KEY ("tentativa_id") REFERENCES "tentativas_arquivo_importacao"("id") ON DELETE SET NULL
);
CREATE INDEX "inventarios_ia_arquivo_usuario_id_arquivo_id_criado_em_idx" ON "inventarios_ia_arquivo"("usuario_id", "arquivo_id", "criado_em");
