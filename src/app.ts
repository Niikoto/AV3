import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyRateLimit from '@fastify/rate-limit';
import type { PrismaClient } from './generated/prisma/client.js';
import { registrarRotasApi } from './routes/api.js';
import { registrarRotasPublicas } from './routes/publicApi.js';

const descricoesRotas: Record<string, string> = {
  'GET /health': 'Verifica a disponibilidade da API e a conexão com o banco de dados.',
  'POST /api/v1/public/analyses/efficiency': 'Calcula e persiste snapshot de eficiência da organização vinculada à chave.',
  'POST /api/v1/public/analyses/profitability': 'Calcula e persiste snapshot de recuperação e referência de depreciação da organização vinculada à chave.',
  'POST /api/v1/public/analyses/remaining-life': 'Calcula e persiste snapshot de vida útil remanescente da organização vinculada à chave.',
  'POST /auth/login': 'Autentica um usuário e retorna um token de acesso Bearer.',
  'POST /auth/logout': 'Encerra a sessão atual revogando o token de acesso.',
  'POST /auth/credentials': 'Cria uma credencial de acesso; na configuração inicial, permite criar a primeira conta administrativa.',
  'GET /auth/credentials': 'Lista as credenciais de usuários cadastradas.',
  'GET /auth/credentials/search': 'Busca credenciais de usuários pelo nome informado.',
  'GET /auth/credentials/:id': 'Consulta os dados de uma credencial pelo identificador.',
  'PATCH /auth/credentials/:id/name': 'Altera o nome de exibição de uma credencial.',
  'PATCH /auth/credentials/:id/role': 'Altera o papel e as permissões de uma credencial.',
  'PUT /auth/credentials/:id/password': 'Redefine a senha de uma credencial.',
  'DELETE /auth/credentials/:id': 'Desativa uma credencial de acesso.',
  'PUT /auth/password': 'Altera a senha do usuário autenticado.',
  'GET /organizations': 'Lista organizações, com filtros opcionais por nome e situação.',
  'POST /organizations': 'Cadastra uma organização.',
  'GET /organizations/:id': 'Consulta os dados de uma organização.',
  'PATCH /organizations/:id': 'Atualiza os dados informados de uma organização.',
  'DELETE /organizations/:id': 'Desativa uma organização mediante o motivo informado.',
  'GET /organizations/:id/contracts': 'Lista os contratos vinculados a uma organização.',
  'GET /organizations/:id/contracts/:contratoId': 'Consulta um contrato específico da organização.',
  'POST /organizations/:id/contracts': 'Cadastra um contrato para uma organização.',
  'PATCH /organizations/:id/contracts/:contratoId': 'Atualiza cláusulas, valor ou renovação automática de um contrato.',
  'POST /organizations/:id/contracts/renew': 'Renova o contrato vigente da organização com a nova data de vencimento.',
  'POST /organizations/:id/contracts/:contratoId/cancel': 'Cancela um contrato específico da organização.',
  'POST /organizations/:id/contracts/close': 'Encerra o contrato vigente da organização.',
  'GET /lots': 'Lista lotes com filtros opcionais por organização, período, situação e cancelamento.',
  'POST /lots': 'Cadastra um lote para uma organização.',
  'POST /lots/with-equipment': 'Cadastra um lote e seus equipamentos em uma única operação.',
  'GET /lots/:id': 'Consulta os dados e os equipamentos associados a um lote.',
  'PATCH /lots/:id': 'Atualiza os dados informados de um lote.',
  'POST /lots/:id/triage': 'Conclui a triagem de um lote.',
  'POST /lots/:id/equipment': 'Adiciona um equipamento a um lote.',
  'DELETE /lots/:id': 'Cancela um lote mediante o motivo informado.',
  'GET /equipment': 'Lista equipamentos com filtros opcionais, paginação e ordenação.',
  'GET /equipment/:id': 'Consulta os dados de um equipamento.',
  'GET /equipment/:id/tracking': 'Consulta o histórico de rastreamento e movimentações de um equipamento.',
  'GET /equipment/:id/recoveries': 'Lista registros observados de recuperação de materiais do equipamento.',
  'POST /equipment/:id/recoveries': 'Registra de forma auditável o valor recuperado de um material do equipamento.',
  'GET /equipment/:id/failures': 'Lista eventos de falha registrados para o equipamento.',
  'POST /equipment/:id/failures': 'Registra um evento histórico de falha do equipamento.',
  'PATCH /equipment/:id': 'Atualiza os dados cadastrais do equipamento mediante controle de versão.',
  'PATCH /equipment/:id/status': 'Atualiza a situação de rastreamento de um equipamento.',
  'PATCH /equipment/:id/physical-state': 'Atualiza o estado físico de um equipamento e registra uma justificativa opcional.',
  'POST /equipment/:id/movements': 'Registra uma movimentação do equipamento para o destino informado.',
  'POST /equipment/:id/movements/corrections': 'Corrige uma movimentação existente, informando o destino correto e a justificativa.',
  'POST /equipment/:id/movements/reversals': 'Estorna uma movimentação existente mediante justificativa.',
  'POST /equipment/:id/cancel': 'Cancela logicamente o equipamento, preservando o histórico.',
  'DELETE /equipment/:id': 'Exclui permanentemente o equipamento, suas movimentações e auditorias relacionadas.',
  'GET /global-parameters': 'Consulta os parâmetros globais atuais do sistema.',
  'GET /global-parameters/history': 'Lista o histórico de alterações dos parâmetros globais.',
  'PATCH /global-parameters': 'Atualiza os parâmetros globais informados.',
  'GET /reports/status': 'Gera um relatório operacional dos equipamentos na situação informada.',
  'GET /reports/organizations/:id': 'Gera um relatório da organização para o período informado.',
  'GET /reports/financial': 'Gera um relatório financeiro consolidado para o período informado.',
  'GET /reports/audit': 'Gera um relatório de eventos de auditoria para o período informado.',
  'POST /analyses/efficiency': 'Executa e persiste a análise de eficiência operacional.',
  'POST /analyses/profitability': 'Executa e persiste a análise de rentabilidade por categoria.',
  'POST /analyses/remaining-life': 'Executa e persiste a estimativa preditiva de vida útil remanescente.',
  'GET /analyses': 'Lista resultados analíticos anteriores.',
  'GET /analyses/:id': 'Consulta um resultado analítico pelo identificador.',
};

const rotasSemConteudo = new Set([
  'POST /auth/logout',
  'PATCH /auth/credentials/:id/name',
  'PATCH /auth/credentials/:id/role',
  'PUT /auth/credentials/:id/password',
  'DELETE /auth/credentials/:id',
  'PUT /auth/password',
  'DELETE /organizations/:id',
  'POST /organizations/:id/contracts/:contratoId/cancel',
  'POST /organizations/:id/contracts/close',
  'POST /lots/:id/triage',
  'DELETE /lots/:id',
  'PATCH /equipment/:id/status',
  'PATCH /equipment/:id/physical-state',
  'POST /equipment/:id/movements',
  'POST /equipment/:id/movements/corrections',
  'POST /equipment/:id/movements/reversals',
  'POST /equipment/:id/cancel',
  'DELETE /equipment/:id',
]);

const rotasDeCriacao = new Set([
  'POST /auth/credentials',
  'POST /organizations',
  'POST /organizations/:id/contracts',
  'POST /lots',
  'POST /lots/with-equipment',
  'POST /lots/:id/equipment',
  'POST /equipment/:id/recoveries',
  'POST /equipment/:id/failures',
  'POST /api/v1/public/analyses/efficiency',
  'POST /api/v1/public/analyses/profitability',
  'POST /api/v1/public/analyses/remaining-life',
]);

const rotasDeLista = new Set([
  'GET /auth/credentials',
  'GET /auth/credentials/search',
  'GET /organizations',
  'GET /organizations/:id/contracts',
  'GET /lots',
  'GET /global-parameters/history',
]);

const rotasDeConflito = new Set([
  'POST /auth/credentials',
  'POST /organizations',
  'PATCH /organizations/:id',
  'POST /organizations/:id/contracts',
  'PATCH /organizations/:id/contracts/:contratoId',
  'POST /organizations/:id/contracts/renew',
  'POST /lots',
  'POST /lots/with-equipment',
  'PATCH /lots/:id',
  'POST /lots/:id/equipment',
  'PATCH /equipment/:id',
  'PATCH /equipment/:id/status',
  'PATCH /equipment/:id/physical-state',
  'POST /equipment/:id/movements/corrections',
  'POST /equipment/:id/movements/reversals',
  'POST /equipment/:id/recoveries',
  'POST /equipment/:id/failures',
  'DELETE /equipment/:id',
]);

const respostaObjeto = { $ref: '#/components/schemas/ApiObject' };
const respostaListaObjetos = { $ref: '#/components/schemas/ApiObjectList' };
const respostaErro = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ApiError' },
    },
  },
});

function schemaRespostaSucesso(chaveRota: string) {
  if (chaveRota === 'GET /health') {
    return { $ref: '#/components/schemas/HealthSuccessResponse' };
  }
  if (chaveRota === 'POST /auth/login') {
    return { $ref: '#/components/schemas/LoginResponse' };
  }
  if (rotasDeLista.has(chaveRota)) {
    return respostaListaObjetos;
  }
  if (chaveRota === 'GET /equipment') {
    return { $ref: '#/components/schemas/EquipmentListResponse' };
  }
  if (chaveRota.startsWith('GET /reports/')) {
    return { type: 'string' };
  }
  return respostaObjeto;
}

export function criarAplicacao(
  prisma: PrismaClient,
  jwtSecret = process.env.JWT_SECRET,
  jwtExpiresIn = process.env.JWT_EXPIRES_IN ?? '30m',
) {
  if (!jwtSecret || jwtSecret.length < 32 || jwtSecret === 'replace_with_a_random_secret_of_at_least_32_characters') {
    throw new Error('JWT_SECRET deve ser um segredo próprio com pelo menos 32 caracteres.');
  }
  if (!/^[1-9]\d{0,5}[smhd]$/.test(jwtExpiresIn)) {
    throw new Error('JWT_EXPIRES_IN deve ser uma duração positiva em segundos, minutos, horas ou dias (ex.: 30m).');
  }

  const app = Fastify({
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
    logger: {
      level: 'info',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.senha',
          'req.body.senhaAtual',
          'req.body.senhaNova',
        ],
        censor: '[REDACTED]',
      },
    },
  });

  app.register(fastifyJwt, { secret: jwtSecret });
  app.register(fastifyRateLimit, {
    global: false,
  });
  app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Greencode API',
        description: 'API REST do sistema de logística reversa. Os papéis e regras de autorização estão descritos no Manual da API.',
        version: '1.0.0',
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
          apiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
            description: 'Chave secreta fornecida ao parceiro externo.',
          },
        },
        schemas: {
          ApiError: {
            type: 'object',
            required: ['error', 'message'],
            additionalProperties: false,
            properties: {
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
          ApiObject: {
            type: 'object',
            additionalProperties: true,
          },
          ApiObjectList: {
            type: 'array',
            items: { $ref: '#/components/schemas/ApiObject' },
          },
          EquipmentListResponse: {
            type: 'object',
            required: ['dados', 'total', 'pagina', 'limite', 'totalPaginas'],
            additionalProperties: false,
            properties: {
              dados: {
                type: 'array',
                items: { $ref: '#/components/schemas/ApiObject' },
              },
              total: { type: 'integer', minimum: 0 },
              pagina: { type: 'integer', minimum: 1 },
              limite: { type: 'integer', minimum: 1, maximum: 100 },
              totalPaginas: { type: 'integer', minimum: 0 },
            },
          },
          HealthSuccessResponse: {
            type: 'object',
            required: ['status', 'database'],
            additionalProperties: false,
            properties: {
              status: { type: 'string', enum: ['ok'] },
              database: { type: 'string', enum: ['connected'] },
            },
          },
          HealthUnavailableResponse: {
            type: 'object',
            required: ['status', 'database'],
            additionalProperties: false,
            properties: {
              status: { type: 'string', enum: ['unavailable'] },
              database: { type: 'string', enum: ['disconnected'] },
            },
          },
          LoginResponse: {
            type: 'object',
            required: ['token', 'tokenType', 'expiresIn', 'usuario'],
            additionalProperties: false,
            properties: {
              token: { type: 'string' },
              tokenType: { type: 'string', enum: ['Bearer'] },
              expiresIn: { type: 'string' },
              usuario: {
                type: 'object',
                required: ['id', 'usuario', 'nomeExibicao', 'papel'],
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  usuario: { type: 'string' },
                  nomeExibicao: { type: 'string' },
                  papel: {
                    type: 'string',
                    enum: ['ADMINISTRADOR', 'OPERADOR_CADASTRO', 'GESTOR_ALMOXARIFADO', 'AUDITOR'],
                  },
                },
              },
            },
          },
        },
      },
      tags: [
        { name: 'Health', description: 'Disponibilidade da API e do banco.' },
        { name: 'Authentication', description: 'Login, senha e gestão de credenciais.' },
        { name: 'Organizations', description: 'Organizações e contratos.' },
        { name: 'Operations', description: 'Lotes, equipamentos, status e movimentações.' },
        { name: 'Global parameters', description: 'Parâmetros globais e histórico.' },
        { name: 'Reports', description: 'Relatórios operacionais, financeiros e de auditoria.' },
        { name: 'Analyses', description: 'Análises operacionais, de rentabilidade e vida útil.' },
        { name: 'Public API', description: 'Endpoints versionados para parceiros externos.' },
        { name: 'API administration', description: 'Gestão administrativa de parceiros e chaves de API.' },
      ],
    },
    transform: ({ schema, url, route }) => {
      const method = Array.isArray(route.method) ? route.method[0] : route.method;
      const publicRoute = (method === 'GET' && url === '/health')
        || (method === 'POST' && url === '/auth/login');
      const publicApiRoute = url.startsWith('/api/v1/public');
      const publicApiHealthRoute = publicApiRoute && method === 'GET' && url.endsWith('/health');
      const initialCredentialRoute = method === 'POST' && url === '/auth/credentials';
      const tag = url === '/health'
        ? 'Health'
        : url.startsWith('/api/v1/public')
          ? 'Public API'
          : url.startsWith('/api/v1/admin')
            ? 'API administration'
        : url.startsWith('/auth/')
          ? 'Authentication'
          : url.startsWith('/organizations')
            ? 'Organizations'
            : url.startsWith('/lots') || url.startsWith('/equipment')
              ? 'Operations'
              : url.startsWith('/global-parameters')
                ? 'Global parameters'
                : url.startsWith('/analyses')
                  ? 'Analyses'
                  : 'Reports';
      const security: NonNullable<typeof schema.security> = publicApiHealthRoute
        ? []
        : publicApiRoute
          ? [{ apiKeyAuth: [] }]
          : publicRoute
        ? []
        : initialCredentialRoute
          ? [{}, { bearerAuth: [] }]
          : [{ bearerAuth: [] }];
      const routeSchema = schema ?? {};
      const chaveRota = `${method} ${url}`;
      const descricao = descricoesRotas[chaveRota]
        ?? 'Executa a operação indicada por esta rota da API.';

      return {
        schema: {
          ...routeSchema,
          tags: routeSchema.tags ?? [tag],
          summary: routeSchema.summary ?? descricoesRotas[chaveRota] ?? `${method} ${url}`,
          description: routeSchema.description ?? descricao,
          security,
        },
        url,
      };
    },
    transformObject: (documentObject) => {
      if (!('openapiObject' in documentObject)) return documentObject.swaggerObject;
      const { openapiObject } = documentObject;
      const paths = openapiObject.paths ?? {};
      for (const path of Object.keys(paths)) {
        const pathItem = paths[path];
        if (!pathItem) continue;
        const url = path.replace(/\{([^}]+)\}/g, ':$1');
        for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
          const operation = pathItem[method];
          if (!operation) continue;
          const chaveRota = `${method.toUpperCase()} ${url}`;
          const codigoSucesso = rotasSemConteudo.has(chaveRota)
            ? '204'
            : rotasDeCriacao.has(chaveRota) ? '201' : '200';
          const temBearer = operation.security?.some((regra) => 'bearerAuth' in regra) ?? false;
          const respostasExistentes = Object.fromEntries(
            Object.entries(operation.responses).filter(([status]) => (
              status !== '200' || codigoSucesso === '200'
            )),
          );
          const respostas = {
            ...respostasExistentes,
            [codigoSucesso]: codigoSucesso === '204'
              ? { description: 'Operação concluída sem corpo de resposta.' }
              : {
                description: codigoSucesso === '201' ? 'Registro criado.' : 'Operação concluída.',
                content: chaveRota.startsWith('GET /reports/')
                  ? { 'text/plain': { schema: schemaRespostaSucesso(chaveRota) } }
                  : { 'application/json': { schema: schemaRespostaSucesso(chaveRota) } },
              },
            ...((operation.requestBody || operation.parameters?.length)
              ? { '400': respostaErro('Entrada inválida ou incompatível com as regras da operação.') }
              : {}),
            ...((temBearer || chaveRota === 'POST /auth/login')
              ? { '401': respostaErro('Autenticação ausente, inválida, expirada ou revogada.') }
              : {}),
            ...(temBearer && !['POST /auth/logout', 'PUT /auth/password'].includes(chaveRota)
              ? { '403': respostaErro('O papel do usuário não permite esta operação.') }
              : {}),
            ...((url.includes(':id') || url.includes(':contratoId'))
              ? { '404': respostaErro('O recurso solicitado não foi encontrado.') }
              : {}),
            ...(rotasDeConflito.has(chaveRota)
              ? { '409': respostaErro('Conflito de versão, duplicidade ou integridade dos dados.') }
              : {}),
            ...((chaveRota === 'GET /health')
              ? {
                '503': {
                  description: 'Banco de dados indisponível.',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/HealthUnavailableResponse' },
                    },
                  },
                },
              }
              : {}),
            '500': respostaErro('Erro interno do servidor; a mensagem é sanitizada.'),
          };
          operation.responses = respostas;
        }
      }
      return openapiObject;
    },
  });
  app.register(async (api) => {
    registrarRotasApi(api, prisma, jwtExpiresIn);
    registrarRotasPublicas(api, prisma);

    api.get('/health', async (_request, reply) => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return { status: 'ok', database: 'connected' };
      } catch (error) {
        api.log.error(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'Health check não conseguiu consultar o banco de dados.',
        );
        return reply.code(503).send({ status: 'unavailable', database: 'disconnected' });
      }
    });
  });
  app.register(fastifySwaggerUi, {
    routePrefix: '/documentation',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({
      error: 'NOT_FOUND',
      message: 'Rota não encontrada.',
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const candidateStatusCode = error instanceof Error && 'statusCode' in error
      ? error.statusCode
      : undefined;
    const statusCode = typeof candidateStatusCode === 'number'
      && candidateStatusCode >= 400
      && candidateStatusCode < 600
      ? candidateStatusCode
      : 500;

    if (statusCode >= 500) {
      request.log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError', statusCode },
        'Falha ao processar requisição.',
      );
    } else {
      request.log.warn(
        { errorName: error instanceof Error ? error.name : 'UnknownError', statusCode },
        'Requisição inválida.',
      );
    }

    const codeByStatus: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
    };
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : codeByStatus[statusCode] ?? 'BAD_REQUEST',
      message: statusCode >= 500
        ? 'Erro interno do servidor.'
        : error instanceof Error ? error.message : 'Requisição inválida.',
    });
  });

  return app;
}
