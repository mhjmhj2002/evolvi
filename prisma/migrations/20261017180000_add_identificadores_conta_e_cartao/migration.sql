-- AlterTable
ALTER TABLE "contas" ADD COLUMN "numero_conta" VARCHAR(50),
ADD COLUMN "agencia" VARCHAR(20),
ADD COLUMN "digitos_cartao" VARCHAR(10);

-- AlterTable
ALTER TABLE "staging_lancamentos_importacao" ADD COLUMN "numero_conta" VARCHAR(50),
ADD COLUMN "digitos_cartao" VARCHAR(10);
