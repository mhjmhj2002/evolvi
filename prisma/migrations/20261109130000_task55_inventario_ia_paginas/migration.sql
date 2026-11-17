CREATE TABLE "inventarios_ia_paginas" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "usuario_id" UUID NOT NULL,
  "inventario_id" UUID NOT NULL,
  "pagina" INTEGER NOT NULL,
  "possui_movimentos" BOOLEAN NOT NULL DEFAULT false,
  "quantidade_esperada" INTEGER NOT NULL DEFAULT 0,
  "quantidade_extraida" INTEGER,
  "soma_absoluta_esperada" DECIMAL(14,2),
  "soma_absoluta_extraida" DECIMAL(14,2),
  "divergencias" JSONB,
  "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventarios_ia_paginas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventarios_ia_paginas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE,
  CONSTRAINT "inventarios_ia_paginas_inventario_id_fkey" FOREIGN KEY ("inventario_id") REFERENCES "inventarios_ia_arquivo"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "uq_inventario_ia_pagina" ON "inventarios_ia_paginas"("inventario_id", "pagina");
CREATE INDEX "idx_inventario_ia_pagina_usuario" ON "inventarios_ia_paginas"("usuario_id", "inventario_id");
