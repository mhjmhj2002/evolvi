-- CreateEnum
CREATE TYPE "status_conexao_bancaria" AS ENUM ('CONECTADO', 'EXPIRADO', 'ERRO_AUTENTICACAO', 'REVOGADO');

-- CreateTable
CREATE TABLE "conexoes_bancarias" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "instituicao_codigo" VARCHAR(20) NOT NULL,
    "instituicao_nome" VARCHAR(100) NOT NULL,
    "compe" VARCHAR(10),
    "status" "status_conexao_bancaria" NOT NULL DEFAULT 'CONECTADO',
    "consentimento_id" VARCHAR(255),
    "consentimento_expira_em" TIMESTAMPTZ(6),
    "ultima_sincronizacao_em" TIMESTAMPTZ(6),
    "mensagem_erro" TEXT,
    "parametros_extras" TEXT,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conexoes_bancarias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_conexoes_usuario" ON "conexoes_bancarias"("usuario_id");

-- CreateIndex
CREATE INDEX "idx_conexoes_instituicao" ON "conexoes_bancarias"("instituicao_codigo");

-- AddForeignKey
ALTER TABLE "conexoes_bancarias" ADD CONSTRAINT "conexoes_bancarias_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
