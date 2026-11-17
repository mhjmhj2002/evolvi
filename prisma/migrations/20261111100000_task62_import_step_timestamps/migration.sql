ALTER TABLE arquivos_importacao
  ADD COLUMN upload_iniciado_em TIMESTAMPTZ(6),
  ADD COLUMN upload_finalizado_em TIMESTAMPTZ(6),
  ADD COLUMN extracao_iniciada_em TIMESTAMPTZ(6),
  ADD COLUMN extracao_finalizada_em TIMESTAMPTZ(6),
  ADD COLUMN staging_iniciado_em TIMESTAMPTZ(6),
  ADD COLUMN staging_finalizado_em TIMESTAMPTZ(6),
  ADD COLUMN consolidacao_iniciada_em TIMESTAMPTZ(6),
  ADD COLUMN consolidacao_finalizada_em TIMESTAMPTZ(6);
