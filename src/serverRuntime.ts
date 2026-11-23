import type { FastifyInstance } from 'fastify';
import cron from 'node-cron';
import type { PrismaClient } from './generated/prisma/client.js';

import { criarAplicacao } from './app.js';
import { ServicoAnaliticoPrisma } from './services/prisma/ServicoAnaliticoPrisma.js';

export async function iniciarServidorHttp(
  prisma: PrismaClient,
  port: number,
): Promise<FastifyInstance> {
  const app = criarAplicacao(prisma);

  try {
    await prisma.$connect();
    const address = await app.listen({ host: '127.0.0.1', port });
    configurarAnalisesAgendadas(app, prisma);
    app.log.info({ address }, 'Servidor HTTP iniciado.');
    return app;
  } catch (error) {
    app.log.error(
      {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorCode: obterCodigoErro(error),
      },
      'Não foi possível conectar ao banco ou iniciar o servidor HTTP.',
    );
    await app.close();
    throw error;
  }

  function configurarAnalisesAgendadas(app: FastifyInstance, prisma: PrismaClient): void {
    if (process.env.ANALYTICAL_CRON_ENABLED !== 'true') return;
    const expressao = process.env.ANALYTICAL_CRON ?? '0 2 * * *';
    if (!cron.validate(expressao)) {
      app.log.error({ expressao }, 'Expressão de agendamento das análises inválida.');
      return;
    }

    const analises = new ServicoAnaliticoPrisma(prisma);
    const tarefa = cron.schedule(expressao, async () => {
      app.log.info('Executando análises agendadas.');
      try {
        await analises.executarEficiencia();
        await analises.executarRentabilidade();
        await analises.executarVidaUtil();
        app.log.info('Análises agendadas concluídas.');
      } catch (error) {
        app.log.error(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'Falha ao executar análises agendadas.',
        );
      }
    });
    app.addHook('onClose', () => tarefa.stop());
    app.log.info({ expressao }, 'Agendamento das análises ativado.');
  }
}

function obterCodigoErro(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}
