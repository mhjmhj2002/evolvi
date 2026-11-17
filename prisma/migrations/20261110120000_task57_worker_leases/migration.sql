ALTER TABLE "arquivos_importacao"
  ADD COLUMN "worker_owner" VARCHAR(80),
  ADD COLUMN "worker_lease_until" TIMESTAMPTZ(6),
  ADD COLUMN "worker_stage" VARCHAR(30),
  ADD COLUMN "worker_attempts" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "idx_arquivos_worker_lease"
  ON "arquivos_importacao"("status", "worker_lease_until");

