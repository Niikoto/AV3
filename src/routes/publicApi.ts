import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import type { PrismaClient } from '../generated/prisma/client.js';
import { EstadoFisico, PermissaoApi, TipoEquipamento } from '../generated/prisma/enums.js';
import { ServicoApiPublicaPrisma, type ContextoParceiro } from '../services/prisma/ServicoApiPublicaPrisma.js';
import { ServicoAnaliticoPrisma } from '../services/prisma/ServicoAnaliticoPrisma.js';
import { ServicoLotePrisma } from '../services/prisma/ServicoLotePrisma.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ServicoFilaRelatorios } from '../services/async/ServicoFilaRelatorios.js';
import { EstadoTarefa, TipoRelatorioAsync } from '../generated/prisma/enums.js';

declare module 'fastify' {
  interface FastifyRequest {
    parceiroApi?: ContextoParceiro;
  }
}

export function registrarRotasPublicas(app: FastifyInstance, prisma: PrismaClient): void {
  const apiPublica = new ServicoApiPublicaPrisma(prisma);
  const analises = new ServicoAnaliticoPrisma(prisma);
  const lotes = new ServicoLotePrisma(prisma);
  const fila = new ServicoFilaRelatorios(prisma, app);
  const configuradoMaximo = Number(process.env.PUBLIC_API_RATE_LIMIT_MAX ?? '60');
  const configuradoJanela = process.env.PUBLIC_API_RATE_LIMIT_WINDOW ?? '1 minute';

  const autenticarChave: preHandlerHookHandler = async (request, reply) => {
    const cabecalho = request.headers['x-api-key'];
    const chave = Array.isArray(cabecalho) ? cabecalho[0] : cabecalho;
    try {
      request.parceiroApi = await apiPublica.validarChave(chave);
    } catch (error) {
      return reply.code(401).send({
        error: 'UNAUTHORIZED',
        message: error instanceof Error ? error.message : 'Chave de API inválida.',
      });
    }
  };

  app.register(async (publica) => {
    await fila.iniciar();
    publica.addHook('onClose', async () => fila.encerrar());
    await publica.register(fastifyRateLimit, {
      max: Number.isInteger(configuradoMaximo) && configuradoMaximo > 0 ? configuradoMaximo : 60,
      timeWindow: configuradoJanela,
      keyGenerator: (request) => {
        const cabecalho = request.headers['x-api-key'];
        return Array.isArray(cabecalho) ? cabecalho[0] ?? 'sem-chave' : cabecalho ?? 'sem-chave';
      },
    });

    publica.get('/api/v1/public/health', async (_request, reply) => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return { status: 'ok', database: 'connected' };
      } catch {
        return reply.code(503).send({ status: 'unavailable', database: 'disconnected' });
      }
    });

    publica.get<{ Params: { id: string } }>('/api/v1/public/equipment/:id/tracking', {
      preHandler: autenticarChave,
    }, async (request, reply) => {
      const contexto = request.parceiroApi;
      if (!contexto) return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Chave necessária.' });
      try {
        apiPublica.exigirPermissao(contexto, PermissaoApi.RASTREAMENTO_LEITURA);
      } catch (error) {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: error instanceof Error ? error.message : 'Permissão insuficiente.',
        });
      }
      const equipamento = await prisma.equipamento.findFirst({
        where: {
          id: request.params.id,
          cancelado: false,
          lote: { organizacaoId: contexto.organizacaoId, cancelado: false },
        },
        include: {
          lote: { select: { id: true, statusProcessamento: true } },
          movimentacoes: { orderBy: [{ dataHora: 'asc' }, { id: 'asc' }] },
        },
      });
      if (!equipamento) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Equipamento não encontrado.' });
      }
      return equipamento;
    });

    publica.get('/api/v1/public/lots', {
      preHandler: autenticarChave,
    }, async (request, reply) => {
      const contexto = request.parceiroApi;
      if (!contexto) return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Chave necessária.' });
      try {
        apiPublica.exigirPermissao(contexto, PermissaoApi.LOTES_LEITURA);
      } catch (error) {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: error instanceof Error ? error.message : 'Permissão insuficiente.',
        });
      }
      return prisma.lote.findMany({
        where: { organizacaoId: contexto.organizacaoId, cancelado: false },
        include: { equipamentos: { where: { cancelado: false } } },
        orderBy: { dataEntrada: 'desc' },
      });
    });

    publica.post<{
      Body: {
        id: string; dataEntrada: string; notaFiscal: string; transportadora: string; observacoes?: string;
        equipamentos?: Array<{
          id: string; codigoBarrasInterno: string; tipo: TipoEquipamento; marca: string; modelo: string;
          anoFabricacao: number; estadoFisico: EstadoFisico; pesoQuilogramas: number;
        }>;
      };
    }>('/api/v1/public/lots', {
      preHandler: autenticarChave,
      schema: {
        body: {
          type: 'object',
          required: ['id', 'dataEntrada', 'notaFiscal', 'transportadora'],
          additionalProperties: false,
          properties: {
            id: { type: 'string', minLength: 1 },
            dataEntrada: { type: 'string', format: 'date-time' },
            notaFiscal: { type: 'string', minLength: 1 },
            transportadora: { type: 'string', minLength: 1 },
            observacoes: { type: 'string' },
            equipamentos: {
              type: 'array',
              minItems: 1,
              maxItems: 500,
              items: {
                type: 'object',
                required: [
                  'id', 'codigoBarrasInterno', 'tipo', 'marca', 'modelo',
                  'anoFabricacao', 'estadoFisico', 'pesoQuilogramas',
                ],
                additionalProperties: false,
                properties: {
                  id: { type: 'string', minLength: 1, pattern: '\\S' },
                  codigoBarrasInterno: { type: 'string', minLength: 1, pattern: '\\S' },
                  tipo: { type: 'string', enum: Object.values(TipoEquipamento) },
                  marca: { type: 'string', minLength: 1, pattern: '\\S' },
                  modelo: { type: 'string', minLength: 1, pattern: '\\S' },
                  anoFabricacao: { type: 'integer', minimum: 1900, maximum: new Date().getFullYear() },
                  estadoFisico: { type: 'string', enum: Object.values(EstadoFisico) },
                  pesoQuilogramas: { type: 'number', exclusiveMinimum: 0 },
                },
              },
            },
          },
        },
      },
    }, async (request, reply) => {
      const contexto = request.parceiroApi;
      if (!contexto) return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Chave necessária.' });
      try {
        apiPublica.exigirPermissao(contexto, PermissaoApi.LOTES_ESCRITA);
      } catch (error) {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: error instanceof Error ? error.message : 'Permissão insuficiente.',
        });
      }
      try {
        const dadosLote = {
          id: request.body.id,
          dataEntrada: new Date(request.body.dataEntrada),
          organizacaoId: contexto.organizacaoId,
          notaFiscal: request.body.notaFiscal,
          transportadora: request.body.transportadora,
          observacoes: request.body.observacoes,
        };
        const responsavel = `parceiro:${contexto.parceiroId}`;
        const lote = request.body.equipamentos
          ? await lotes.criarLoteComEquipamentos(dadosLote, request.body.equipamentos, responsavel)
          : await lotes.criarLote(dadosLote, responsavel);
        return reply.code(201).send(lote);
      } catch (error) {
        return reply.code(400).send({
          error: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Não foi possível criar o lote.',
        });
      }
    });

    publica.get<{ Querystring: { categoria?: Parameters<typeof analises.listar>[0]; limite?: number } }>(
      '/api/v1/public/analyses',
      { preHandler: autenticarChave },
      async (request, reply) => {
        const contexto = request.parceiroApi;
        if (!contexto) return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Chave necessária.' });
        try {
          apiPublica.exigirPermissao(contexto, PermissaoApi.ANALISES_LEITURA);
        } catch (error) {
          return reply.code(403).send({
            error: 'FORBIDDEN',
            message: error instanceof Error ? error.message : 'Permissão insuficiente.',
          });
        }
        return analises.listar(request.query.categoria, request.query.limite, contexto.organizacaoId);
      },
    );

    const schemaPeriodoAnalise = {
      type: 'object',
      additionalProperties: false,
      properties: {
        inicio: { type: 'string', format: 'date-time' },
        fim: { type: 'string', format: 'date-time' },
      },
    } as const;
    const schemaPeriodoObrigatorio = {
      ...schemaPeriodoAnalise,
      required: ['inicio', 'fim'],
    } as const;
    type PeriodoAnaliseBody = { inicio?: string; fim?: string };
    const validarPeriodoPublico = (periodo: PeriodoAnaliseBody) => {
      if (Boolean(periodo.inicio) !== Boolean(periodo.fim)) {
        return 'Informe início e fim juntos.';
      }
      if (periodo.inicio && periodo.fim
        && (!Number.isFinite(Date.parse(periodo.inicio)) || !Number.isFinite(Date.parse(periodo.fim))
          || Date.parse(periodo.inicio) > Date.parse(periodo.fim))) {
        return 'Informe um período válido, com início anterior ou igual ao fim.';
      }
      return null;
    };
    const periodoDate = (periodo: PeriodoAnaliseBody) => ({
      ...(periodo.inicio ? { inicio: new Date(periodo.inicio) } : {}),
      ...(periodo.fim ? { fim: new Date(periodo.fim) } : {}),
    });

    publica.post<{ Body: PeriodoAnaliseBody }>('/api/v1/public/analyses/efficiency', {
      preHandler: autenticarChave,
      schema: {
        tags: ['API pública v1'], summary: 'Calcula eficiência operacional da organização do parceiro',
        description: 'Cria um snapshot analítico com média e mediana globais, por operador e organização, além de agrupamento mensal. O período filtra a data de entrada; o agrupamento mensal usa a conclusão da triagem.',
        security: [{ apiKeyAuth: [] }], body: schemaPeriodoObrigatorio,
        response: { 201: { type: 'object', additionalProperties: true } },
      },
    }, async (request, reply) => {
      const contexto = request.parceiroApi;
      if (!contexto) return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Chave necessária.' });
      try {
        apiPublica.exigirPermissao(contexto, PermissaoApi.ANALISES_LEITURA);
      } catch (error) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: error instanceof Error ? error.message : 'Permissão insuficiente.' });
      }
      const erroPeriodo = validarPeriodoPublico(request.body);
      if (erroPeriodo) return reply.code(400).send({ error: 'BAD_REQUEST', message: erroPeriodo });
      return reply.code(201).send(await analises.executarEficiencia({ ...periodoDate(request.body), organizacaoId: contexto.organizacaoId }));
    });

    publica.post<{ Body: PeriodoAnaliseBody }>('/api/v1/public/analyses/profitability', {
      preHandler: autenticarChave,
      schema: {
        tags: ['API pública v1'], summary: 'Calcula rentabilidade observada e estimada da organização do parceiro',
        description: 'Cria um snapshot de recuperação estimada e realizada, por categoria e moeda. Os valores não representam lucro líquido.',
        security: [{ apiKeyAuth: [] }], body: schemaPeriodoObrigatorio,
        response: { 201: { type: 'object', additionalProperties: true } },
      },
    }, async (request, reply) => {
      const contexto = request.parceiroApi;
      if (!contexto) return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Chave necessária.' });
      try {
        apiPublica.exigirPermissao(contexto, PermissaoApi.ANALISES_LEITURA);
      } catch (error) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: error instanceof Error ? error.message : 'Permissão insuficiente.' });
      }
      const erroPeriodo = validarPeriodoPublico(request.body);
      if (erroPeriodo) return reply.code(400).send({ error: 'BAD_REQUEST', message: erroPeriodo });
      return reply.code(201).send(await analises.executarRentabilidade({ ...periodoDate(request.body), organizacaoId: contexto.organizacaoId }));
    });

    publica.post<{ Body: PeriodoAnaliseBody }>('/api/v1/public/analyses/remaining-life', {
      preHandler: autenticarChave,
      schema: {
        tags: ['API pública v1'], summary: 'Calcula vida útil remanescente da organização do parceiro',
        description: 'Cria um snapshot de estimativa de vida útil com o histórico disponível. O período é opcional.',
        security: [{ apiKeyAuth: [] }], body: schemaPeriodoAnalise,
        response: { 201: { type: 'object', additionalProperties: true } },
      },
    }, async (request, reply) => {
      const contexto = request.parceiroApi;
      if (!contexto) return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Chave necessária.' });
      try {
        apiPublica.exigirPermissao(contexto, PermissaoApi.ANALISES_LEITURA);
      } catch (error) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: error instanceof Error ? error.message : 'Permissão insuficiente.' });
      }
      const erroPeriodo = validarPeriodoPublico(request.body);
      if (erroPeriodo) return reply.code(400).send({ error: 'BAD_REQUEST', message: erroPeriodo });
      return reply.code(201).send(await analises.executarVidaUtil({ ...periodoDate(request.body), organizacaoId: contexto.organizacaoId }));
    });

    publica.post<{
      Body: { tipo?: TipoRelatorioAsync; formato?: 'json' | 'csv' };
    }>('/api/v1/public/reports/async', {
      preHandler: autenticarChave,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tipo: {
              type: 'string',
              enum: ['EFICIENCIA_OPERACIONAL', 'RENTABILIDADE', 'VIDA_UTIL_REMANESCENTE', 'COMPLETO'],
            },
            formato: { type: 'string', enum: ['json', 'csv'] },
          },
        },
      },
    }, async (request, reply) => {
      const contexto = request.parceiroApi;
      if (!contexto) return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Chave necessária.' });
      try {
        apiPublica.exigirPermissao(contexto, PermissaoApi.ANALISES_LEITURA);
      } catch (error) {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: error instanceof Error ? error.message : 'Permissão insuficiente.',
        });
      }
      try {
        const tarefa = await fila.solicitar({
          parceiroId: contexto.parceiroId,
          chaveId: contexto.chaveId,
          organizacaoId: contexto.organizacaoId,
          tipo: request.body.tipo ?? TipoRelatorioAsync.COMPLETO,
          formato: request.body.formato ?? 'json',
        });
        return reply.code(202).send(tarefa);
      } catch (error) {
        app.log.warn(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'Solicitação de relatório assíncrono não pôde ser enfileirada.',
        );
        return reply.code(503).send({
          error: 'ASYNC_UNAVAILABLE',
          message: 'Fila de relatórios temporariamente indisponível.',
        });
      }
    });

    publica.get<{ Params: { id: string } }>('/api/v1/public/reports/:id/status', {
      preHandler: autenticarChave,
    }, async (request, reply) => {
      const contexto = request.parceiroApi;
      if (!contexto) return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Chave necessária.' });
      try {
        apiPublica.exigirPermissao(contexto, PermissaoApi.ANALISES_LEITURA);
      } catch (error) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Permissão insuficiente.' });
      }
      const tarefa = await fila.consultar(request.params.id, contexto.parceiroId);
      if (!tarefa) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Tarefa não encontrada.' });
      return {
        id: tarefa.id,
        estado: tarefa.estado,
        tentativas: tarefa.tentativas,
        criadoEm: tarefa.criadoEm,
        iniciadoEm: tarefa.iniciadoEm,
        concluidoEm: tarefa.concluidoEm,
        erro: tarefa.estado === EstadoTarefa.FALHOU ? tarefa.erro : null,
      };
    });

    publica.get<{ Params: { id: string } }>('/api/v1/public/reports/:id/download', {
      preHandler: autenticarChave,
    }, async (request, reply) => {
      const contexto = request.parceiroApi;
      if (!contexto) return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Chave necessária.' });
      try {
        apiPublica.exigirPermissao(contexto, PermissaoApi.ANALISES_LEITURA);
      } catch (error) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Permissão insuficiente.' });
      }
      const tarefa = await fila.consultar(request.params.id, contexto.parceiroId);
      if (!tarefa) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Tarefa não encontrada.' });
      if (tarefa.estado !== EstadoTarefa.CONCLUIDA || !tarefa.arquivoNome) {
        if (tarefa.estado === EstadoTarefa.FALHOU) {
          return reply.code(422).send({ error: 'TASK_FAILED', message: tarefa.erro ?? 'Relatório falhou.' });
        }
        return reply.code(409).send({ error: 'TASK_NOT_READY', message: 'Relatório ainda não está disponível.' });
      }
      try {
        const caminho = join(process.cwd(), 'reports', tarefa.arquivoNome);
        const conteudo = await readFile(caminho);
        reply.header(
          'Content-Type',
          tarefa.formato === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
        );
        reply.header('Content-Disposition', `attachment; filename="${tarefa.arquivoNome}"`);
        return reply.send(conteudo);
      } catch {
        return reply.code(404).send({ error: 'FILE_NOT_FOUND', message: 'Arquivo do relatório não encontrado.' });
      }
    });
  });
}
