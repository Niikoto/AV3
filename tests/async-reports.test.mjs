import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { Queue, QueueEvents, Worker, createPostgresBackend } from 'bullmq';
import { Pool } from 'pg';

const pausar = (duracaoMs) => new Promise((resolve) => setTimeout(resolve, duracaoMs));

test('limpeza de relatórios remove arquivos e tarefas expiradas sem tocar no histórico analítico', async () => {
  const { ServicoFilaRelatorios } = await import('../dist/services/async/ServicoFilaRelatorios.js');
  const idConcluido = randomUUID();
  const idFalhou = randomUUID();
  const caminhoConcluido = join(process.cwd(), 'reports', `${idConcluido}.json`);
  const tarefasRemovidas = [];
  let filtroConsultado;
  await mkdir(join(process.cwd(), 'reports'), { recursive: true });
  await writeFile(caminhoConcluido, '{"teste":true}', 'utf8');
  const fila = new ServicoFilaRelatorios({
    tarefaRelatorio: {
      findMany: async ({ where }) => {
        filtroConsultado = where;
        return [
          { id: idConcluido, estado: 'CONCLUIDA', arquivoNome: `${idConcluido}.json` },
          { id: idFalhou, estado: 'FALHOU', arquivoNome: null },
        ];
      },
      deleteMany: async ({ where }) => { tarefasRemovidas.push(where.id); return { count: 1 }; },
    },
  });

  try {
    await fila.limparTarefasExpiradas();
    assert.deepEqual(tarefasRemovidas.sort(), [idConcluido, idFalhou].sort());
    assert.equal(filtroConsultado.OR[0].estado, 'CONCLUIDA');
    assert.equal(filtroConsultado.OR[1].estado, 'FALHOU');
    await assert.rejects(access(caminhoConcluido));
  } finally {
    await fila.encerrar();
  }
});

test('BullMQ PostgreSQL mantém e recupera trabalhos, tenta novamente e processa em paralelo', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const schema = `bullmq_stability_${randomUUID().replaceAll('-', '')}`;
  const nomeFila = 'greencode-stability';
  const connection = {
    connectionString: process.env.DATABASE_URL,
    schema,
    migrate: true,
    max: 8,
  };
  const options = { connection };
  const fila = new Queue(nomeFila, options, createPostgresBackend);
  const eventos = new QueueEvents(nomeFila, options, createPostgresBackend);
  const adminDb = new Pool({ connectionString: process.env.DATABASE_URL });
  let worker;
  let ativos = 0;
  let maximoAtivos = 0;
  let repeticoes = 0;
  let identificadorFalhaFinal;
  const falhasObservadas = [];

  const criarWorker = () => {
    const instancia = new Worker(
      nomeFila,
      async (job) => {
        ativos += 1;
        maximoAtivos = Math.max(maximoAtivos, ativos);
        try {
          if (job.name === 'retry-once' && job.attemptsMade === 0) {
            repeticoes += 1;
            throw new Error('Falha transitória de teste.');
          }
          if (job.name === 'always-fail') {
            identificadorFalhaFinal = job.id;
            throw new Error('Falha permanente de teste.');
          }
          if (job.name === 'parallel') await pausar(25);
          return { recebido: job.data };
        } finally {
          ativos -= 1;
        }
      },
      { connection, concurrency: 4 },
      createPostgresBackend,
    );
    instancia.on('failed', (job) => {
      falhasObservadas.push({
        nome: job.name,
        tentativas: job.attemptsMade,
        limite: job.opts.attempts,
      });
    });
    return instancia;
  };

  for (const instancia of [fila, eventos]) instancia.on('error', () => {});

  try {
    await Promise.all([fila.waitUntilReady(), eventos.waitUntilReady()]);

    // A tarefa fica persistida enquanto não há worker e é retomada por uma nova instância.
    const pendente = await fila.add('retomar-apos-reinicio', { sequencia: 1 });
    worker = criarWorker();
    worker.on('error', () => {});
    await worker.waitUntilReady();
    assert.deepEqual(
      await pendente.waitUntilFinished(eventos, 15_000),
      { recebido: { sequencia: 1 } },
    );
    await worker.close();
    worker = undefined;

    // Uma falha temporária é tentada novamente e concluída na segunda tentativa.
    worker = criarWorker();
    worker.on('error', () => {});
    await worker.waitUntilReady();
    const comRetry = await fila.add('retry-once', { sequencia: 2 }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 50 },
    });
    assert.deepEqual(
      await comRetry.waitUntilFinished(eventos, 15_000),
      { recebido: { sequencia: 2 } },
    );
    assert.equal(repeticoes, 1);
    assert.equal((await fila.getJob(comRetry.id))?.attemptsMade, 2);
    assert.deepEqual(falhasObservadas, [{ nome: 'retry-once', tentativas: 1, limite: 3 }]);

    // Uma falha permanente termina no limite configurado de tentativas.
    const falhaFinal = await fila.add('always-fail', { sequencia: 3 }, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 25 },
    });
    await assert.rejects(falhaFinal.waitUntilFinished(eventos, 15_000), /Falha permanente de teste/);
    assert.equal(identificadorFalhaFinal, falhaFinal.id);
    assert.equal((await fila.getJob(falhaFinal.id))?.attemptsMade, 2);
    assert.deepEqual(
      falhasObservadas.slice(1),
      [
        { nome: 'always-fail', tentativas: 1, limite: 2 },
        { nome: 'always-fail', tentativas: 2, limite: 2 },
      ],
    );

    // Uma carga paralela verifica que vários workers podem reivindicar jobs sem duplicá-los.
    await worker.pause();
    const resultadosConcluidos = new Promise((resolve, reject) => {
      const resultadosParalelos = [];
      const concluir = (operacao) => {
        clearTimeout(temporizador);
        worker.off('completed', aoConcluir);
        worker.off('failed', aoFalhar);
        operacao();
      };
      const aoConcluir = (job, resultado) => {
        if (job.name !== 'parallel') return;
        resultadosParalelos.push(resultado);
        if (resultadosParalelos.length === 32) concluir(() => resolve(resultadosParalelos));
      };
      const aoFalhar = (job, erro) => {
        if (job?.name === 'parallel') concluir(() => reject(erro));
      };
      const temporizador = setTimeout(
        () => concluir(() => reject(new Error('Lote concorrente excedeu 15 segundos.'))),
        15_000,
      );
      worker.on('completed', aoConcluir);
      worker.on('failed', aoFalhar);
    });
    await Promise.all(Array.from({ length: 32 }, (_, indice) => (
      fila.add('parallel', { indice })
    )));
    await worker.resume();
    const resultados = await resultadosConcluidos;
    assert.equal(resultados.length, 32);
    assert.deepEqual(
      resultados.map((resultado) => resultado.recebido.indice).sort((a, b) => a - b),
      Array.from({ length: 32 }, (_, indice) => indice),
    );
    assert.ok(maximoAtivos >= 2, `concorrência observada foi ${maximoAtivos}`);
    assert.ok(maximoAtivos <= 4, `concorrência excedeu o limite: ${maximoAtivos}`);

    console.log(JSON.stringify({
      estabilidade: 'aprovada',
      tarefasConcorrentes: resultados.length,
      tentativasAteSucesso: 2,
      tentativasAteFalhaFinal: 2,
      concorrenciaMaximaObservada: maximoAtivos,
    }));
  } finally {
    await worker?.close().catch(() => {});
    await eventos.close().catch(() => {});
    await fila.close().catch(() => {});
    try {
      await adminDb.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await adminDb.end();
    }
  }
});
