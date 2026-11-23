import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  Queue,
  Worker,
  createPostgresBackend,
  type JobProgress,
  type PostgresConnectionOptions,
  type PostgresQueueBackend,
} from 'bullmq';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { EstadoTarefa, TipoRelatorioAsync } from '../../generated/prisma/enums.js';
import { ServicoAnaliticoPrisma } from '../prisma/ServicoAnaliticoPrisma.js';

type DadosRelatorio = {
  tarefaId: string;
  parceiroId: string;
  chaveId: string;
  organizacaoId: string;
  tipo: TipoRelatorioAsync;
  formato: 'json' | 'csv';
};

type FilaRelatorios = Queue<
  DadosRelatorio,
  unknown,
  string,
  DadosRelatorio,
  unknown,
  string,
  PostgresQueueBackend,
  PostgresConnectionOptions
>;
type WorkerRelatorios = Worker<
  DadosRelatorio,
  void,
  string,
  PostgresQueueBackend,
  JobProgress,
  PostgresConnectionOptions
>;

export class ServicoFilaRelatorios {
  private queue: FilaRelatorios | null = null;
  private worker: WorkerRelatorios | null = null;
  private readonly diretorioRelatorios = join(process.cwd(), 'reports');

  constructor(
    private prisma: PrismaClient,
    private app?: FastifyInstance,
  ) {}

  async iniciar(): Promise<boolean> {
    if (process.env.ASYNC_REPORTS_ENABLED === 'false') return false;
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      this.app?.log.warn('Relatórios assíncronos desativados: DATABASE_URL não está configurada.');
      return false;
    }

    const concorrencia = this.numeroPositivo(process.env.ASYNC_REPORT_CONCURRENCY, 2);
    const limiteConexoes = this.numeroPositivo(
      process.env.ASYNC_REPORT_DB_POOL_MAX,
      Math.max(4, concorrencia + 1),
    );
    const connection: PostgresConnectionOptions = {
      connectionString: databaseUrl,
      schema: 'bullmq',
      migrate: true,
      max: limiteConexoes,
    };
    this.queue = new Queue<DadosRelatorio, unknown, string, DadosRelatorio, unknown, string, PostgresQueueBackend, PostgresConnectionOptions>(
      'greencode-relatorios',
      { connection },
      createPostgresBackend,
    );

    this.worker = new Worker<DadosRelatorio, void, string, PostgresQueueBackend, JobProgress, PostgresConnectionOptions>(
      'greencode-relatorios',
      async (job) => {
        try {
          await this.processar(job.data);
        } catch (error) {
          await this.registrarFalha(
            job.data.tarefaId,
            job.attemptsMade + 1,
            job.opts.attempts ?? 1,
            error instanceof Error ? error : new Error('Falha ao gerar relatório.'),
          ).catch((falhaAoRegistrar) => this.app?.log.error(
            { errorName: falhaAoRegistrar instanceof Error ? falhaAoRegistrar.name : 'UnknownError' },
            'Não foi possível atualizar o estado da tarefa antes do retry.',
          ));
          throw error;
        }
      },
      {
        connection,
        concurrency: concorrencia,
      },
      createPostgresBackend,
    );

    this.queue.on('error', (error) => this.app?.log.error(
      { errorName: error.name },
      'Erro na fila PostgreSQL de relatórios.',
    ));
    this.worker.on('error', (error) => this.app?.log.error(
      { errorName: error.name },
      'Erro no worker PostgreSQL de relatórios.',
    ));

    this.worker.on('failed', (job, error) => {
      const tentativasMaximas = job?.opts.attempts ?? 1;
      if (job && job.attemptsMade >= tentativasMaximas) {
        void this.registrarFalha(
          job.data.tarefaId,
          job.attemptsMade,
          tentativasMaximas,
          error,
        ).catch((falhaAoRegistrar) => this.app?.log.error(
          { errorName: falhaAoRegistrar instanceof Error ? falhaAoRegistrar.name : 'UnknownError' },
          'Não foi possível atualizar o estado após esgotar os retries.',
        ));
      }
      this.app?.log.error(
        {
          jobId: job?.id,
          errorName: error.name,
          tentativa: job?.attemptsMade,
          tentativasMaximas: job?.opts.attempts ?? 1,
        },
        'Falha em tarefa assíncrona de relatório.',
      );
    });
    try {
      await Promise.all([this.queue.waitUntilReady(), this.worker.waitUntilReady()]);
    } catch (error) {
      await this.encerrar();
      this.app?.log.warn(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'PostgreSQL indisponível; filas assíncronas permanecerão desativadas.',
      );
      return false;
    }
    try {
      await mkdir(this.diretorioRelatorios, { recursive: true });
    } catch (error) {
      await this.encerrar();
      this.app?.log.warn(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'Relatórios assíncronos desativados: diretório de saída indisponível.',
      );
      return false;
    }
    return true;
  }

  async solicitar(dados: Omit<DadosRelatorio, 'tarefaId'>): Promise<{ id: string; estado: EstadoTarefa }> {
    if (!this.queue) throw new Error('Fila assíncrona indisponível. Configure ASYNC_REPORTS_ENABLED=true e DATABASE_URL.');
    const id = randomUUID();
    await this.prisma.tarefaRelatorio.create({
      data: {
        id,
        parceiroId: dados.parceiroId,
        chaveId: dados.chaveId,
        organizacaoId: dados.organizacaoId,
        tipo: dados.tipo,
        formato: dados.formato,
        estado: EstadoTarefa.AGUARDANDO,
      },
    });

    try {
      await this.queue.add('gerar-relatorio', { ...dados, tarefaId: id }, {
        jobId: id,
        attempts: this.numeroPositivo(process.env.ASYNC_REPORT_ATTEMPTS, 3),
        backoff: {
          type: 'exponential',
          delay: this.numeroPositivo(process.env.ASYNC_REPORT_BACKOFF_MS, 1000),
        },
        removeOnComplete: 100,
        removeOnFail: 100,
      });
    } catch (error) {
      await this.prisma.tarefaRelatorio.update({
        where: { id },
        data: { estado: EstadoTarefa.FALHOU, erro: 'Não foi possível adicionar o relatório à fila.' },
      }).catch((falhaAoRegistrar) => this.app?.log.error(
        { errorName: falhaAoRegistrar instanceof Error ? falhaAoRegistrar.name : 'UnknownError' },
        'Não foi possível registrar a falha ao adicionar uma tarefa à fila.',
      ));
      throw error;
    }
    return { id, estado: EstadoTarefa.AGUARDANDO };
  }

  async consultar(tarefaId: string, parceiroId: string) {
    return this.prisma.tarefaRelatorio.findFirst({
      where: { id: tarefaId, parceiroId },
    });
  }

  async encerrar(): Promise<void> {
    const worker = this.worker;
    const queue = this.queue;
    this.worker = null;
    this.queue = null;
    const encerramentos = await Promise.allSettled([
      ...(worker ? [worker.close()] : []),
      ...(queue ? [queue.close()] : []),
    ]);
    for (const resultado of encerramentos) {
      if (resultado.status === 'rejected') {
        this.app?.log.warn(
          { errorName: resultado.reason instanceof Error ? resultado.reason.name : 'UnknownError' },
          'Falha ao encerrar uma conexão da fila de relatórios.',
        );
      }
    }
  }

  private numeroPositivo(valor: string | undefined, padrao: number): number {
    const numero = Number(valor ?? padrao);
    return Number.isInteger(numero) && numero > 0 ? numero : padrao;
  }

  private async processar(dados: DadosRelatorio): Promise<void> {
    await this.prisma.tarefaRelatorio.update({
      where: { id: dados.tarefaId },
      data: { estado: EstadoTarefa.PROCESSANDO, iniciadoEm: new Date(), tentativas: { increment: 1 } },
    });

    const analitico = new ServicoAnaliticoPrisma(this.prisma);
    let conteudo: unknown;
    if (dados.tipo === TipoRelatorioAsync.EFICIENCIA_OPERACIONAL) {
      conteudo = await analitico.executarEficiencia(
        { organizacaoId: dados.organizacaoId },
        `${dados.tarefaId}-EFICIENCIA_OPERACIONAL`,
      );
    } else if (dados.tipo === TipoRelatorioAsync.RENTABILIDADE) {
      conteudo = await analitico.executarRentabilidade(
        { organizacaoId: dados.organizacaoId },
        `${dados.tarefaId}-RENTABILIDADE`,
      );
    } else if (dados.tipo === TipoRelatorioAsync.VIDA_UTIL_REMANESCENTE) {
      conteudo = await analitico.executarVidaUtil(
        { organizacaoId: dados.organizacaoId },
        `${dados.tarefaId}-VIDA_UTIL_REMANESCENTE`,
      );
    } else {
      conteudo = {
        eficiencia: await analitico.executarEficiencia(
          { organizacaoId: dados.organizacaoId },
          `${dados.tarefaId}-EFICIENCIA_OPERACIONAL`,
        ),
        rentabilidade: await analitico.executarRentabilidade(
          { organizacaoId: dados.organizacaoId },
          `${dados.tarefaId}-RENTABILIDADE`,
        ),
        vidaUtil: await analitico.executarVidaUtil(
          { organizacaoId: dados.organizacaoId },
          `${dados.tarefaId}-VIDA_UTIL_REMANESCENTE`,
        ),
      };
    }

    const arquivoNome = `${dados.tarefaId}.${dados.formato}`;
    const conteudoArquivo = dados.formato === 'csv'
      ? this.converterCsv(conteudo)
      : JSON.stringify(conteudo, null, 2);
    await writeFile(join(this.diretorioRelatorios, arquivoNome), conteudoArquivo, 'utf8');
    await this.prisma.tarefaRelatorio.update({
      where: { id: dados.tarefaId },
      data: {
        estado: EstadoTarefa.CONCLUIDA,
        concluidoEm: new Date(),
        arquivoNome,
        erro: null,
      },
    });
  }

  private async registrarFalha(
    tarefaId: string | undefined,
    tentativasRealizadas: number,
    tentativasMaximas: number,
    error: Error,
  ): Promise<void> {
    if (!tarefaId) return;
    const falhaFinal = tentativasRealizadas >= tentativasMaximas;
    await this.prisma.tarefaRelatorio.update({
      where: { id: tarefaId },
      data: {
        estado: falhaFinal ? EstadoTarefa.FALHOU : EstadoTarefa.AGUARDANDO,
        tentativas: tentativasRealizadas,
        erro: falhaFinal ? error.message : null,
      },
    });
  }

  private converterCsv(conteudo: unknown): string {
    const linhas = ['categoria,campo,valor'];
    const adicionar = (objeto: unknown, prefixo = '') => {
      if (!objeto || typeof objeto !== 'object') return;
      for (const [chave, valor] of Object.entries(objeto as Record<string, unknown>)) {
        if (valor && typeof valor === 'object') {
          if (Array.isArray(valor)) {
            valor.forEach((item, indice) => adicionar(item, `${prefixo}${chave}[${indice}]`));
          } else {
            adicionar(valor, `${prefixo}${chave}.`);
          }
        } else {
          const campo = `${prefixo}${chave}`.replace(/,/g, ' ');
          const texto = String(valor ?? '').replace(/"/g, '""');
          linhas.push(`"${campo}","valor","${texto}"`);
        }
      }
    };
    adicionar(conteudo);
    return `${linhas.join('\n')}\n`;
  }
}
