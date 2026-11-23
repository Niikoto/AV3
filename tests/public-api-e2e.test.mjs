import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { Queue, createPostgresBackend } from 'bullmq';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { criarAplicacao } from '../dist/app.js';
import { ServicoApiPublicaPrisma } from '../dist/services/prisma/ServicoApiPublicaPrisma.js';
import { ServicoRecuperacaoPrisma } from '../dist/services/prisma/ServicoRecuperacaoPrisma.js';
import { TipoEquipamento, EstadoFisico, PermissaoApi } from '../dist/generated/prisma/enums.js';

test('fluxo público integrado cria lote, executa análises e gera relatórios JSON/CSV', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  process.env.ASYNC_REPORTS_ENABLED = 'true';
  const connection = {
    connectionString: process.env.DATABASE_URL,
    schema: 'bullmq',
    migrate: true,
    max: 8,
  };
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const prefix = `E2E-${randomUUID()}`;
  let app;
  let parceiroId;
  let chaveId;
  let loteId;
  let equipamentoId;
  const taskIds = [];
  const analiseIds = [];
  const arquivos = [];
  let conectado = false;

  try {
    await prisma.$connect();
    conectado = true;
    const organizacao = await prisma.organizacao.findFirst({ where: { ativo: true }, select: { id: true } });
    assert.ok(organizacao, 'O banco de desenvolvimento precisa ter uma organização ativa.');

    const apiPublica = new ServicoApiPublicaPrisma(prisma);
    const parceiro = await apiPublica.criarParceiro(prefix, organizacao.id);
    parceiroId = parceiro.id;
    const chave = await apiPublica.criarChave(parceiro.id, [
      PermissaoApi.LOTES_LEITURA,
      PermissaoApi.LOTES_ESCRITA,
      PermissaoApi.RASTREAMENTO_LEITURA,
      PermissaoApi.ANALISES_LEITURA,
    ]);
    chaveId = chave.registro.id;
    app = criarAplicacao(prisma);
    await app.ready();

    loteId = `${prefix}-LOTE`;
    equipamentoId = `${prefix}-EQUIP`;
    const dataEntrada = new Date();
    const loteCriado = await app.inject({
      method: 'POST',
      url: '/api/v1/public/lots',
      headers: { 'x-api-key': chave.chave },
      payload: {
        id: loteId,
        dataEntrada: dataEntrada.toISOString(),
        notaFiscal: `${prefix}-NF`,
        transportadora: 'Transportadora E2E',
        equipamentos: [{
          id: equipamentoId,
          codigoBarrasInterno: `${prefix}-BC`,
          tipo: TipoEquipamento.NOTEBOOK,
          marca: 'E2E',
          modelo: 'Teste API',
          anoFabricacao: new Date().getFullYear() - 2,
          estadoFisico: EstadoFisico.BOM_ESTADO,
          pesoQuilogramas: 2,
        }],
      },
    });
    assert.equal(loteCriado.statusCode, 201, loteCriado.body);
    assert.equal(loteCriado.json().organizacaoId, organizacao.id);
    assert.equal(loteCriado.json().equipamentos.length, 1);

    const servicoRecuperacao = new ServicoRecuperacaoPrisma(prisma);
    const responsavel = `${prefix}-usuario`;
    for (const [tipo, valorRecuperado] of [['ESTIMADO', 80], ['REALIZADO', 70]]) {
      await servicoRecuperacao.registrar(equipamentoId, {
        tipo,
        material: 'Alumínio',
        valorRecuperado,
        moeda: 'BRL',
        dataRecuperacao: new Date(),
        origem: 'Validação integrada',
      }, responsavel);
    }

    const inicio = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const fim = new Date().toISOString();
    for (const [rota, payload] of [
      ['/api/v1/public/analyses/efficiency', { inicio, fim }],
      ['/api/v1/public/analyses/profitability', { inicio, fim }],
      ['/api/v1/public/analyses/remaining-life', {}],
    ]) {
      const response = await app.inject({ method: 'POST', url: rota, headers: { 'x-api-key': chave.chave }, payload });
      assert.equal(response.statusCode, 201, response.body);
      assert.equal(response.json().organizacaoId, organizacao.id);
      if (rota.endsWith('/profitability')) {
        const categorias = response.json().resultados.categorias;
        assert.ok(categorias.some((categoria) => categoria.recuperacaoEstimada.some((item) => item.total === 80)));
        assert.ok(categorias.some((categoria) => categoria.recuperacaoObservada.some((item) => item.total === 70)));
      }
      analiseIds.push(response.json().id);
    }

    const tarefaJson = await app.inject({
      method: 'POST',
      url: '/api/v1/public/reports/async',
      headers: { 'x-api-key': chave.chave },
      payload: { tipo: 'COMPLETO', formato: 'json' },
    });
    assert.equal(tarefaJson.statusCode, 202, tarefaJson.body);
    const idJson = tarefaJson.json().id;
    taskIds.push(idJson);

    const aguardarConclusao = async (id) => {
      const prazo = Date.now() + 20_000;
      while (Date.now() < prazo) {
        const status = await app.inject({
          method: 'GET', url: `/api/v1/public/reports/${id}/status`,
          headers: { 'x-api-key': chave.chave },
        });
        assert.equal(status.statusCode, 200, status.body);
        if (status.json().estado === 'CONCLUIDA') return status.json();
        if (status.json().estado === 'FALHOU') assert.fail(`A tarefa falhou: ${status.body}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.fail(`A tarefa ${id} não concluiu em 20 segundos.`);
    };

    const statusJson = await aguardarConclusao(idJson);
    const downloadJson = await app.inject({
      method: 'GET', url: `/api/v1/public/reports/${idJson}/download`,
      headers: { 'x-api-key': chave.chave },
    });
    assert.equal(downloadJson.statusCode, 200, downloadJson.body);
    const relatorioJson = JSON.parse(downloadJson.body);
    assert.ok(relatorioJson.eficiencia);
    assert.ok(relatorioJson.rentabilidade);
    assert.ok(relatorioJson.vidaUtil);
    assert.equal(statusJson.estado, 'CONCLUIDA');
    arquivos.push(join(process.cwd(), 'reports', `${idJson}.json`));

    const tarefaCsv = await app.inject({
      method: 'POST',
      url: '/api/v1/public/reports/async',
      headers: { 'x-api-key': chave.chave },
      payload: { tipo: 'COMPLETO', formato: 'csv' },
    });
    assert.equal(tarefaCsv.statusCode, 202, tarefaCsv.body);
    const idCsv = tarefaCsv.json().id;
    taskIds.push(idCsv);
    const statusCsv = await aguardarConclusao(idCsv);
    const downloadCsv = await app.inject({
      method: 'GET', url: `/api/v1/public/reports/${idCsv}/download`,
      headers: { 'x-api-key': chave.chave },
    });
    assert.equal(downloadCsv.statusCode, 200, downloadCsv.body);
    assert.match(downloadCsv.body, /^categoria,campo,valor/);
    assert.match(downloadCsv.body, /tempoMedianoHoras/);
    assert.equal(statusCsv.estado, 'CONCLUIDA');
    arquivos.push(join(process.cwd(), 'reports', `${idCsv}.csv`));

    const listagem = await app.inject({
      method: 'GET', url: '/api/v1/public/analyses',
      headers: { 'x-api-key': chave.chave },
    });
    assert.equal(listagem.statusCode, 200);
    assert.ok(listagem.json().some((item) => analiseIds.includes(item.id)));
  } finally {
    if (app) await app.close().catch(() => {});
    if (conectado) {
      const queue = new Queue('greencode-relatorios', { connection }, createPostgresBackend);
      queue.on('error', () => {});
      try {
        await queue.waitUntilReady();
        for (const id of taskIds) {
          const job = await queue.getJob(id);
          if (job) await job.remove().catch(() => {});
        }
      } finally {
        await queue.close().catch(() => {});
      }
      await Promise.all(arquivos.map((arquivo) => unlink(arquivo).catch(() => {})));
      await prisma.resultadoAnalise.deleteMany({
        where: { OR: [{ id: { in: analiseIds } }, ...taskIds.map((id) => ({ id: { startsWith: id } }))] },
      });
      await prisma.tarefaRelatorio.deleteMany({ where: { id: { in: taskIds } } });
      if (chaveId) await prisma.chaveApi.deleteMany({ where: { id: chaveId } });
      if (parceiroId) await prisma.parceiroApi.deleteMany({ where: { id: parceiroId } });
      if (equipamentoId) {
        await prisma.eventoAuditoria.deleteMany({ where: { usuarioResponsavel: { in: [`parceiro:${parceiroId}`, `${prefix}-usuario`] } } });
        await prisma.movimentacao.deleteMany({ where: { equipamentoId } });
        await prisma.registroRecuperacao.deleteMany({ where: { equipamentoId } });
        await prisma.falhaEquipamento.deleteMany({ where: { equipamentoId } });
        await prisma.equipamento.deleteMany({ where: { id: equipamentoId } });
      }
      if (loteId) await prisma.lote.deleteMany({ where: { id: loteId } });
      await prisma.$disconnect();
    }
  }
});
