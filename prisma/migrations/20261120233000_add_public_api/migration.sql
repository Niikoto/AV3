CREATE TYPE "PermissaoApi" AS ENUM (
  'RASTREAMENTO_LEITURA',
  'LOTES_LEITURA',
  'LOTES_ESCRITA',
  'ANALISES_LEITURA'
);

CREATE TABLE "ParceiroApi" (
  "id" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "organizacaoId" TEXT NOT NULL,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "desativadoEm" TIMESTAMP(3),
  CONSTRAINT "ParceiroApi_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChaveApi" (
  "id" TEXT NOT NULL,
  "parceiroId" TEXT NOT NULL,
  "prefixo" TEXT NOT NULL,
  "hashSecret" TEXT NOT NULL,
  "permissoes" "PermissaoApi"[],
  "ativa" BOOLEAN NOT NULL DEFAULT true,
  "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiraEm" TIMESTAMP(3),
  "revogadaEm" TIMESTAMP(3),
  "ultimoUsoEm" TIMESTAMP(3),
  CONSTRAINT "ChaveApi_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ParceiroApi_nome_organizacaoId_key"
ON "ParceiroApi"("nome", "organizacaoId");
CREATE INDEX "ParceiroApi_organizacaoId_ativo_idx"
ON "ParceiroApi"("organizacaoId", "ativo");
CREATE UNIQUE INDEX "ChaveApi_hashSecret_key" ON "ChaveApi"("hashSecret");
CREATE INDEX "ChaveApi_parceiroId_ativa_idx" ON "ChaveApi"("parceiroId", "ativa");
CREATE INDEX "ChaveApi_prefixo_idx" ON "ChaveApi"("prefixo");

ALTER TABLE "ParceiroApi"
ADD CONSTRAINT "ParceiroApi_organizacaoId_fkey"
FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ChaveApi"
ADD CONSTRAINT "ChaveApi_parceiroId_fkey"
FOREIGN KEY ("parceiroId") REFERENCES "ParceiroApi"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
