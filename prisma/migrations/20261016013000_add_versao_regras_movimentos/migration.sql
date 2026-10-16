-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "versao_regras_movimentos" INTEGER NOT NULL DEFAULT 1;
