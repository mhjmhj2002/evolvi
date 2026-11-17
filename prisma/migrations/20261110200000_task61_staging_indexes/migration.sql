CREATE INDEX idx_staging_lote_status_id
  ON staging_lancamentos_importacao (lote_id, status_processamento, id);

CREATE INDEX idx_staging_lote_data_id
  ON staging_lancamentos_importacao (lote_id, data_movimento, id);
