ALTER TABLE "inventarios_ia_paginas"
  ALTER COLUMN "quantidade_esperada" DROP NOT NULL,
  ALTER COLUMN "quantidade_esperada" DROP DEFAULT;

ALTER TABLE "staging_lancamentos_importacao"
  ADD COLUMN "pagina_origem" INTEGER;
