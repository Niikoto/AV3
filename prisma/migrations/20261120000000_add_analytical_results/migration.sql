CREATE TYPE "CategoriaAnalise" AS ENUM (
  'EFICIENCIA_OPERACIONAL',
  'RENTABILIDADE',
  'VIDA_UTIL_REMANESCENTE'
);

ALTER TABLE "Lote"
ADD COLUMN "dataConclusaoTriagem" TIMESTAMP(3);

CREATE TABLE "ResultadoAnalise" (
  "id" TEXT NOT NULL,
  "categoria" "CategoriaAnalise" NOT NULL,
  "periodoInicio" TIMESTAMP(3),
  "periodoFim" TIMESTAMP(3),
  "realizadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metodo" TEXT NOT NULL,
  "resultados" JSONB NOT NULL,
  "observacoes" TEXT[] DEFAULT ARRAY[]::TEXT[],

  CONSTRAINT "ResultadoAnalise_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ResultadoAnalise_categoria_realizadaEm_idx"
ON "ResultadoAnalise"("categoria", "realizadaEm");

CREATE INDEX "ResultadoAnalise_realizadaEm_idx"
ON "ResultadoAnalise"("realizadaEm");
