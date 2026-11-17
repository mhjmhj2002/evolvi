ALTER TABLE staging_lancamentos_importacao
  ADD COLUMN movimento_id UUID,
  ADD COLUMN motivo_descarte VARCHAR(120);

ALTER TABLE staging_lancamentos_importacao
  ADD CONSTRAINT fk_staging_movimento
  FOREIGN KEY (movimento_id) REFERENCES movimentos(id) ON DELETE SET NULL;

CREATE INDEX idx_staging_movimento
  ON staging_lancamentos_importacao (movimento_id);
