CREATE TYPE "EstadoTarefa" AS ENUM (
  'AGUARDANDO',
  'PROCESSANDO',
  'CONCLUIDA',
  'FALHOU',
  'CANCELADA'
);

CREATE TYPE "TipoRelatorioAsync" AS ENUM (
  'EFICIENCIA_OPERACIONAL',
  'RENTABILIDADE',
  'VIDA_UTIL_REMANESCENTE',
  'COMPLETO'
);

CREATE TABLE "TarefaRelatorio" (
  "id" TEXT NOT NULL,
  "parceiroId" TEXT NOT NULL,
  "chaveId" TEXT NOT NULL,
  "organizacaoId" TEXT NOT NULL,
  "tipo" "TipoRelatorioAsync" NOT NULL,
  "formato" TEXT NOT NULL DEFAULT 'json',
  "estado" "EstadoTarefa" NOT NULL DEFAULT 'AGUARDANDO',
  "tentativas" INTEGER NOT NULL DEFAULT 0,
  "erro" TEXT,
  "arquivoNome" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "iniciadoEm" TIMESTAMP(3),
  "concluidoEm" TIMESTAMP(3),
  CONSTRAINT "TarefaRelatorio_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TarefaRelatorio_parceiroId_criadoEm_idx"
ON "TarefaRelatorio"("parceiroId", "criadoEm");
CREATE INDEX "TarefaRelatorio_organizacaoId_estado_idx"
ON "TarefaRelatorio"("organizacaoId", "estado");
CREATE INDEX "TarefaRelatorio_chaveId_criadoEm_idx"
ON "TarefaRelatorio"("chaveId", "criadoEm");
