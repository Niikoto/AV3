CREATE TYPE "TipoFalhaEquipamento" AS ENUM ('FUNCIONAL', 'ELETRICA', 'MECANICA', 'DESGASTE', 'OUTRA');

CREATE TABLE "RegistroRecuperacao" (
    "id" TEXT NOT NULL,
    "equipamentoId" TEXT NOT NULL,
    "material" TEXT NOT NULL,
    "valorRecuperado" DECIMAL(12,2) NOT NULL,
    "moeda" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "dataRecuperacao" TIMESTAMP(3) NOT NULL,
    "origem" TEXT NOT NULL,
    "observacao" TEXT NOT NULL DEFAULT '',
    "responsavel" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RegistroRecuperacao_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FalhaEquipamento" (
    "id" TEXT NOT NULL,
    "equipamentoId" TEXT NOT NULL,
    "tipo" "TipoFalhaEquipamento" NOT NULL,
    "dataHora" TIMESTAMP(3) NOT NULL,
    "estadoFisico" "EstadoFisico" NOT NULL,
    "descricao" TEXT NOT NULL,
    "responsavel" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FalhaEquipamento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RegistroRecuperacao_equipamentoId_dataRecuperacao_idx"
ON "RegistroRecuperacao"("equipamentoId", "dataRecuperacao");
CREATE INDEX "RegistroRecuperacao_dataRecuperacao_idx"
ON "RegistroRecuperacao"("dataRecuperacao");
CREATE INDEX "FalhaEquipamento_equipamentoId_dataHora_idx"
ON "FalhaEquipamento"("equipamentoId", "dataHora");
CREATE INDEX "FalhaEquipamento_tipo_dataHora_idx"
ON "FalhaEquipamento"("tipo", "dataHora");

ALTER TABLE "RegistroRecuperacao"
ADD CONSTRAINT "RegistroRecuperacao_equipamentoId_fkey"
FOREIGN KEY ("equipamentoId") REFERENCES "Equipamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FalhaEquipamento"
ADD CONSTRAINT "FalhaEquipamento_equipamentoId_fkey"
FOREIGN KEY ("equipamentoId") REFERENCES "Equipamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
