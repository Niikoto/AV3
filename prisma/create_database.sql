-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PapelUsuario" AS ENUM ('ADMINISTRADOR', 'OPERADOR_CADASTRO', 'GESTOR_ALMOXARIFADO', 'AUDITOR');

-- CreateEnum
CREATE TYPE "EstadoFisico" AS ENUM ('NOVO', 'BOM_ESTADO', 'USADO_LEVE', 'USADO_MODERADO', 'DANIFICADO_LEVE', 'DANIFICADO_GRAVE', 'INSERVIVEL');

-- CreateEnum
CREATE TYPE "StatusLote" AS ENUM ('RECEBIDO', 'EM_TRIAGEM', 'TRIAGEM_CONCLUIDA', 'ENCAMINHADO', 'FINALIZADO');

-- CreateEnum
CREATE TYPE "StatusRastreamento" AS ENUM ('AGUARDANDO_TRIAGEM', 'EM_TRIAGEM', 'AGUARDANDO_DESMONTE', 'EM_DESMONTE', 'PECAS_REAPROVEITADAS', 'MATERIAL_RECICLAVEL', 'DESCARTE_SEGURO', 'BAIXA_DEFINITIVA');

-- CreateEnum
CREATE TYPE "TipoEquipamento" AS ENUM ('COMPUTADOR_MESA', 'NOTEBOOK', 'MONITOR', 'IMPRESSORA', 'SERVIDOR', 'ROTEADOR', 'CABO_ESTRUTURADO', 'FONTE_ALIMENTACAO');

-- CreateEnum
CREATE TYPE "TipoEventoMovimentacao" AS ENUM ('MOVIMENTACAO', 'STATUS', 'ESTADO_FISICO', 'CANCELAMENTO', 'CORRECAO', 'ESTORNO');

-- CreateEnum
CREATE TYPE "TipoFalhaEquipamento" AS ENUM ('FUNCIONAL', 'ELETRICA', 'MECANICA', 'DESGASTE', 'OUTRA');

-- CreateEnum
CREATE TYPE "CategoriaAnalise" AS ENUM ('EFICIENCIA_OPERACIONAL', 'RENTABILIDADE', 'VIDA_UTIL_REMANESCENTE');

-- CreateEnum
CREATE TYPE "PermissaoApi" AS ENUM ('RASTREAMENTO_LEITURA', 'LOTES_LEITURA', 'LOTES_ESCRITA', 'ANALISES_LEITURA');

-- CreateEnum
CREATE TYPE "EstadoTarefa" AS ENUM ('AGUARDANDO', 'PROCESSANDO', 'CONCLUIDA', 'FALHOU', 'CANCELADA');

-- CreateEnum
CREATE TYPE "TipoRelatorioAsync" AS ENUM ('EFICIENCIA_OPERACIONAL', 'RENTABILIDADE', 'VIDA_UTIL_REMANESCENTE', 'COMPLETO');

-- CreateTable
CREATE TABLE "Organizacao" (
    "id" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "cnpjNormalizado" TEXT NOT NULL,
    "inscricaoEstadual" TEXT NOT NULL,
    "enderecoCompleto" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "dataCadastro" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "motivoDesativacao" TEXT,
    "contratoVigenteId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Organizacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contrato" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "dataAssinatura" TIMESTAMP(3) NOT NULL,
    "dataVencimento" TIMESTAMP(3) NOT NULL,
    "clausulas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "valorMensal" DOUBLE PRECISION NOT NULL,
    "renovacaoAutomatica" BOOLEAN NOT NULL DEFAULT false,
    "encerradoEm" TIMESTAMP(3),
    "historicoRenovacoes" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Contrato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lote" (
    "id" TEXT NOT NULL,
    "dataEntrada" TIMESTAMP(3) NOT NULL,
    "dataConclusaoTriagem" TIMESTAMP(3),
    "organizacaoId" TEXT NOT NULL,
    "notaFiscal" TEXT NOT NULL,
    "transportadora" TEXT NOT NULL,
    "statusProcessamento" "StatusLote" NOT NULL DEFAULT 'RECEBIDO',
    "observacoes" TEXT NOT NULL DEFAULT '',
    "cancelado" BOOLEAN NOT NULL DEFAULT false,
    "motivoCancelamento" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Lote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipamento" (
    "id" TEXT NOT NULL,
    "codigoBarrasInterno" TEXT NOT NULL,
    "tipo" "TipoEquipamento" NOT NULL,
    "marca" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "anoFabricacao" INTEGER NOT NULL,
    "estadoFisico" "EstadoFisico" NOT NULL,
    "pesoQuilogramas" DOUBLE PRECISION NOT NULL,
    "loteId" TEXT NOT NULL,
    "posicaoNoLote" INTEGER NOT NULL,
    "statusRastreamento" "StatusRastreamento" NOT NULL DEFAULT 'AGUARDANDO_TRIAGEM',
    "cancelado" BOOLEAN NOT NULL DEFAULT false,
    "motivoCancelamento" TEXT,
    "dataCadastro" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Equipamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "Movimentacao" (
    "id" TEXT NOT NULL,
    "equipamentoId" TEXT NOT NULL,
    "dataHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origem" TEXT NOT NULL,
    "destino" TEXT NOT NULL,
    "responsavel" TEXT NOT NULL,
    "observacao" TEXT NOT NULL,
    "tipoEvento" "TipoEventoMovimentacao" NOT NULL DEFAULT 'MOVIMENTACAO',
    "movimentacaoReferenciadaId" TEXT,
    "destinoCorrigido" TEXT,

    CONSTRAINT "Movimentacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credencial" (
    "id" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "hashSenha" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "ultimoAcesso" TIMESTAMP(3) NOT NULL,
    "papel" "PapelUsuario" NOT NULL,
    "nomeExibicao" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Credencial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParametroGlobal" (
    "id" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "aliquotasImpostos" JSONB NOT NULL,
    "coeficienteDepreciacao" DOUBLE PRECISION NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoPor" TEXT NOT NULL,

    CONSTRAINT "ParametroGlobal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoAuditoria" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operacao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "dadosAntes" JSONB,
    "dadosDepois" JSONB,
    "usuarioResponsavel" TEXT NOT NULL,
    "transacaoId" TEXT NOT NULL,
    "fase" TEXT NOT NULL,
    "identificadorAnterior" TEXT,

    CONSTRAINT "EventoAuditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenRevogado" (
    "jti" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenRevogado_pkey" PRIMARY KEY ("jti")
);

-- CreateTable
CREATE TABLE "ResultadoAnalise" (
    "id" TEXT NOT NULL,
    "categoria" "CategoriaAnalise" NOT NULL,
    "organizacaoId" TEXT,
    "periodoInicio" TIMESTAMP(3),
    "periodoFim" TIMESTAMP(3),
    "realizadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metodo" TEXT NOT NULL,
    "resultados" JSONB NOT NULL,
    "observacoes" TEXT[],

    CONSTRAINT "ResultadoAnalise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParceiroApi" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desativadoEm" TIMESTAMP(3),

    CONSTRAINT "ParceiroApi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateIndex
CREATE UNIQUE INDEX "Organizacao_cnpj_key" ON "Organizacao"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "Organizacao_cnpjNormalizado_key" ON "Organizacao"("cnpjNormalizado");

-- CreateIndex
CREATE UNIQUE INDEX "Organizacao_id_contratoVigenteId_key" ON "Organizacao"("id", "contratoVigenteId");

-- CreateIndex
CREATE INDEX "Contrato_organizacaoId_idx" ON "Contrato"("organizacaoId");

-- CreateIndex
CREATE UNIQUE INDEX "Contrato_organizacaoId_id_key" ON "Contrato"("organizacaoId", "id");

-- CreateIndex
CREATE INDEX "Lote_organizacaoId_dataEntrada_idx" ON "Lote"("organizacaoId", "dataEntrada");

-- CreateIndex
CREATE UNIQUE INDEX "Equipamento_codigoBarrasInterno_key" ON "Equipamento"("codigoBarrasInterno");

-- CreateIndex
CREATE INDEX "Equipamento_loteId_statusRastreamento_idx" ON "Equipamento"("loteId", "statusRastreamento");

-- CreateIndex
CREATE UNIQUE INDEX "Equipamento_loteId_posicaoNoLote_key" ON "Equipamento"("loteId", "posicaoNoLote");

-- CreateIndex
CREATE INDEX "RegistroRecuperacao_equipamentoId_dataRecuperacao_idx" ON "RegistroRecuperacao"("equipamentoId", "dataRecuperacao");

-- CreateIndex
CREATE INDEX "RegistroRecuperacao_dataRecuperacao_idx" ON "RegistroRecuperacao"("dataRecuperacao");

-- CreateIndex
CREATE INDEX "FalhaEquipamento_equipamentoId_dataHora_idx" ON "FalhaEquipamento"("equipamentoId", "dataHora");

-- CreateIndex
CREATE INDEX "FalhaEquipamento_tipo_dataHora_idx" ON "FalhaEquipamento"("tipo", "dataHora");

-- CreateIndex
CREATE UNIQUE INDEX "Movimentacao_movimentacaoReferenciadaId_key" ON "Movimentacao"("movimentacaoReferenciadaId");

-- CreateIndex
CREATE INDEX "Movimentacao_equipamentoId_dataHora_idx" ON "Movimentacao"("equipamentoId", "dataHora");

-- CreateIndex
CREATE UNIQUE INDEX "Credencial_usuario_ativo_key" ON "Credencial"("usuario", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "ParametroGlobal_versao_key" ON "ParametroGlobal"("versao");

-- CreateIndex
CREATE INDEX "ParametroGlobal_atualizadoEm_idx" ON "ParametroGlobal"("atualizadoEm");

-- CreateIndex
CREATE INDEX "EventoAuditoria_timestamp_idx" ON "EventoAuditoria"("timestamp");

-- CreateIndex
CREATE INDEX "EventoAuditoria_transacaoId_fase_idx" ON "EventoAuditoria"("transacaoId", "fase");

-- CreateIndex
CREATE INDEX "TokenRevogado_expiraEm_idx" ON "TokenRevogado"("expiraEm");

-- CreateIndex
CREATE INDEX "ResultadoAnalise_categoria_realizadaEm_idx" ON "ResultadoAnalise"("categoria", "realizadaEm");

-- CreateIndex
CREATE INDEX "ResultadoAnalise_realizadaEm_idx" ON "ResultadoAnalise"("realizadaEm");

-- CreateIndex
CREATE INDEX "ResultadoAnalise_organizacaoId_realizadaEm_idx" ON "ResultadoAnalise"("organizacaoId", "realizadaEm");

-- CreateIndex
CREATE INDEX "ParceiroApi_organizacaoId_ativo_idx" ON "ParceiroApi"("organizacaoId", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "ParceiroApi_nome_organizacaoId_key" ON "ParceiroApi"("nome", "organizacaoId");

-- CreateIndex
CREATE UNIQUE INDEX "ChaveApi_hashSecret_key" ON "ChaveApi"("hashSecret");

-- CreateIndex
CREATE INDEX "ChaveApi_parceiroId_ativa_idx" ON "ChaveApi"("parceiroId", "ativa");

-- CreateIndex
CREATE INDEX "ChaveApi_prefixo_idx" ON "ChaveApi"("prefixo");

-- CreateIndex
CREATE INDEX "TarefaRelatorio_parceiroId_criadoEm_idx" ON "TarefaRelatorio"("parceiroId", "criadoEm");

-- CreateIndex
CREATE INDEX "TarefaRelatorio_organizacaoId_estado_idx" ON "TarefaRelatorio"("organizacaoId", "estado");

-- CreateIndex
CREATE INDEX "TarefaRelatorio_chaveId_criadoEm_idx" ON "TarefaRelatorio"("chaveId", "criadoEm");

-- AddForeignKey
ALTER TABLE "Organizacao" ADD CONSTRAINT "Organizacao_id_contratoVigenteId_fkey" FOREIGN KEY ("id", "contratoVigenteId") REFERENCES "Contrato"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contrato" ADD CONSTRAINT "Contrato_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipamento" ADD CONSTRAINT "Equipamento_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "Lote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistroRecuperacao" ADD CONSTRAINT "RegistroRecuperacao_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "Equipamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FalhaEquipamento" ADD CONSTRAINT "FalhaEquipamento_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "Equipamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimentacao" ADD CONSTRAINT "Movimentacao_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "Equipamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimentacao" ADD CONSTRAINT "Movimentacao_movimentacaoReferenciadaId_fkey" FOREIGN KEY ("movimentacaoReferenciadaId") REFERENCES "Movimentacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParceiroApi" ADD CONSTRAINT "ParceiroApi_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChaveApi" ADD CONSTRAINT "ChaveApi_parceiroId_fkey" FOREIGN KEY ("parceiroId") REFERENCES "ParceiroApi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
