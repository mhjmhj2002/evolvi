ALTER TABLE arquivos_importacao
  ADD COLUMN duracao_staging_ms INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN duracao_consolidacao_ms INTEGER NOT NULL DEFAULT 0;
