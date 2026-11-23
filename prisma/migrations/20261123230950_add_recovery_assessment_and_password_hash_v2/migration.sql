-- CreateEnum
CREATE TYPE "TipoRegistroRecuperacao" AS ENUM ('ESTIMADO', 'REALIZADO');

-- AlterTable
ALTER TABLE "Credencial" ALTER COLUMN "salt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "RegistroRecuperacao" ADD COLUMN     "tipo" "TipoRegistroRecuperacao" NOT NULL DEFAULT 'REALIZADO';
