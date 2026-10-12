-- CreateEnum
CREATE TYPE "role_usuario" AS ENUM ('OWNER', 'ADMIN', 'USER');

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "role" "role_usuario" NOT NULL DEFAULT 'USER';
