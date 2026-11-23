import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularMedia,
  calcularRegressaoLinear,
  ServicoAnaliticoPrisma,
} from '../dist/services/prisma/ServicoAnaliticoPrisma.js';
import { createHash } from 'node:crypto';
import { ServicoApiPublicaPrisma } from '../dist/services/prisma/ServicoApiPublicaPrisma.js';
import { PermissaoApi } from '../dist/generated/prisma/enums.js';

test('cálculos analíticos calculam médias e rejeitam amostras insuficientes', () => {
  assert.equal(calcularMedia([]), null);
  assert.equal(calcularMedia([2, 4, 6]), 4);
  assert.equal(calcularRegressaoLinear([{ x: 1, y: 2 }]), null);
  assert.equal(calcularRegressaoLinear([{ x: 1, y: 2 }, { x: 1, y: 3 }]), null);
});

test('regressão linear simples é calculada pelos mínimos quadrados ordinários', () => {
  const resultado = calcularRegressaoLinear([
    { x: 1, y: 1 },
    { x: 2, y: 3 },
    { x: 3, y: 5 },
  ]);

  assert.ok(resultado);
  assert.equal(resultado.inclinacao, 2);
  assert.equal(resultado.intercepto, -1);
});

test('reprocessamento do mesmo relatório atualiza o resultado analítico sem duplicá-lo', async () => {
  const resultados = new Map();
  const prisma = {
    lote: { findMany: async () => [] },
    resultadoAnalise: {
      upsert: async ({ where, create, update }) => {
        const existente = resultados.get(where.id);
        const resultado = existente ? { ...existente, ...update } : create;
        resultados.set(where.id, resultado);
        return resultado;
      },
    },
  };
  const servico = new ServicoAnaliticoPrisma(prisma);

  await servico.executarEficiencia({ organizacaoId: 'ORG-1' }, 'TAREFA-1-EFICIENCIA');
  await servico.executarEficiencia({ organizacaoId: 'ORG-1' }, 'TAREFA-1-EFICIENCIA');

  assert.equal(resultados.size, 1);
  assert.equal(resultados.get('TAREFA-1-EFICIENCIA').id, 'TAREFA-1-EFICIENCIA');
});

test('chave pública é armazenada por hash e validada sem revelar segredo', async () => {
  let registroChave;
  const prisma = {
    organizacao: {
      findUnique: async () => ({ id: 'ORG-1', ativo: true }),
    },
    parceiroApi: {
      findUnique: async () => ({
        id: 'PARTNER-1',
        nome: 'Parceiro',
        organizacaoId: 'ORG-1',
        ativo: true,
      }),
      create: async ({ data }) => data,
    },
    chaveApi: {
      create: async ({ data }) => {
        registroChave = data;
        return data;
      },
      findUnique: async ({ where }) => (
        where.hashSecret === registroChave.hashSecret
          ? {
              ...registroChave,
              ativa: true,
              revogadaEm: null,
              expiraEm: null,
              parceiro: { id: 'PARTNER-1', nome: 'Parceiro', organizacaoId: 'ORG-1', ativo: true },
              parceiroId: 'PARTNER-1',
            }
          : null
      ),
      update: async () => ({}),
      findMany: async () => [],
    },
  };
  const servico = new ServicoApiPublicaPrisma(prisma);
  const criada = await servico.criarChave(
    'PARTNER-1',
    [PermissaoApi.RASTREAMENTO_LEITURA],
  );

  assert.ok(criada.chave.startsWith('gc_live_'));
  assert.equal(
    registroChave.hashSecret,
    createHash('sha256').update(criada.chave).digest('hex'),
  );
  const contexto = await servico.validarChave(criada.chave);
  assert.equal(contexto.organizacaoId, 'ORG-1');
  assert.deepEqual(contexto.permissoes, [PermissaoApi.RASTREAMENTO_LEITURA]);
});
