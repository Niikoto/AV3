ALTER TABLE "ResultadoAnalise"
ADD COLUMN "organizacaoId" TEXT;

CREATE INDEX "ResultadoAnalise_organizacaoId_realizadaEm_idx"
ON "ResultadoAnalise"("organizacaoId", "realizadaEm");
