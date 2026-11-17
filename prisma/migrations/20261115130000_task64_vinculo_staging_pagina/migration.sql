-- TASK-64: cria vínculo relacional direto para auditar cada lançamento
-- de staging até a página do inventário e o arquivo original.
ALTER TABLE "staging_lancamentos_importacao"
ADD COLUMN "inventario_pagina_id" UUID;

CREATE INDEX "idx_staging_inventario_pagina"
ON "staging_lancamentos_importacao"("inventario_pagina_id");

ALTER TABLE "staging_lancamentos_importacao"
ADD CONSTRAINT "staging_lancamentos_importacao_inventario_pagina_id_fkey"
FOREIGN KEY ("inventario_pagina_id")
REFERENCES "inventarios_ia_paginas"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
