import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import {
  EstadoFisico,
  PapelUsuario,
  StatusLote,
  StatusRastreamento,
  TipoEquipamento,
} from '../dist/generated/prisma/enums.js';
import { ServicoAutenticacaoPrisma } from '../dist/services/prisma/ServicoAutenticacaoPrisma.js';
import { ServicoAuditoriaPrisma } from '../dist/services/prisma/ServicoAuditoriaPrisma.js';
import { ServicoEquipamentoPrisma } from '../dist/services/prisma/ServicoEquipamentoPrisma.js';
import { ServicoLotePrisma } from '../dist/services/prisma/ServicoLotePrisma.js';
import { ServicoOrganizacaoPrisma } from '../dist/services/prisma/ServicoOrganizacaoPrisma.js';
import { ServicoParametrosGlobaisPrisma } from '../dist/services/prisma/ServicoParametrosGlobaisPrisma.js';
import { ServicoRelatorioPrisma } from '../dist/services/prisma/ServicoRelatorioPrisma.js';
import { ServicoAnaliticoPrisma } from '../dist/services/prisma/ServicoAnaliticoPrisma.js';

function gerarCnpj() {
  const base = `${Math.floor(Math.random() * 100_000_000).toString().padStart(8, '0')}0001`;
  const calcularDigito = (digitos, pesos) => {
    const soma = [...digitos].reduce((total, digito, indice) => (
      total + Number(digito) * pesos[indice]
    ), 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const primeiro = calcularDigito(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const segundo = calcularDigito(`${base}${primeiro}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${primeiro}${segundo}`;
}

test('listagem de equipamentos combina filtros, paginação e ordenação estável', async () => {
  const chamadas = [];
  const prisma = {
    equipamento: {
      findMany: async (argumentos) => {
        chamadas.push({ operacao: 'listar', argumentos });
        return [{ id: 'EQ-001' }];
      },
      count: async (argumentos) => {
        chamadas.push({ operacao: 'contar', argumentos });
        return 31;
      },
    },
  };
  const servico = new ServicoEquipamentoPrisma(prisma);

  const resultado = await servico.listarEquipamentos({
    loteId: 'LOTE-001',
    nome: '  dell  ',
    status: StatusRastreamento.EM_TRIAGEM,
    estadoFisico: EstadoFisico.BOM_ESTADO,
    pagina: 2,
    limite: 10,
    ordenarPor: 'marca',
  });

  assert.deepEqual(resultado, {
    dados: [{ id: 'EQ-001' }],
    total: 31,
    pagina: 2,
    limite: 10,
    totalPaginas: 4,
  });
  assert.deepEqual(chamadas[0].argumentos.where, {
    loteId: 'LOTE-001',
    OR: [
      { marca: { contains: 'dell', mode: 'insensitive' } },
      { modelo: { contains: 'dell', mode: 'insensitive' } },
    ],
    statusRastreamento: StatusRastreamento.EM_TRIAGEM,
    estadoFisico: EstadoFisico.BOM_ESTADO,
    cancelado: false,
  });
  assert.deepEqual(chamadas[0].argumentos, {
    where: chamadas[1].argumentos.where,
    skip: 10,
    take: 10,
    orderBy: [
      { marca: 'asc' },
      { loteId: 'asc' },
      { posicaoNoLote: 'asc' },
      { id: 'asc' },
    ],
  });
  assert.deepEqual(chamadas[1], {
    operacao: 'contar',
    argumentos: { where: chamadas[0].argumentos.where },
  });

  const resultadoPadrao = await servico.listarEquipamentos({ incluirCancelados: true });
  assert.deepEqual(resultadoPadrao, {
    dados: [{ id: 'EQ-001' }],
    total: 31,
    pagina: 1,
    limite: 20,
    totalPaginas: 2,
  });
  assert.deepEqual(chamadas[2].argumentos.where, {});
  assert.deepEqual(chamadas[2].argumentos.orderBy, [
    { loteId: 'asc' },
    { posicaoNoLote: 'asc' },
    { id: 'asc' },
  ]);
  assert.equal(chamadas[2].argumentos.skip, 0);
  assert.equal(chamadas[2].argumentos.take, 20);

  const servicoVazio = new ServicoEquipamentoPrisma({
    equipamento: {
      findMany: async () => [],
      count: async () => 0,
    },
  });
  assert.deepEqual(await servicoVazio.listarEquipamentos(), {
    dados: [],
    total: 0,
    pagina: 1,
    limite: 20,
    totalPaginas: 0,
  });
});

test('consulta de contrato exige que ele pertença à organização informada', async () => {
  const contrato = {
    id: 'CONTRATO-CONSULTA',
    organizacaoId: 'ORG-CONSULTA',
    clausulas: ['Cláusula'],
  };
  const servico = new ServicoOrganizacaoPrisma({
    contrato: {
      findUnique: async ({ where }) => where.id === contrato.id ? contrato : null,
    },
  });

  assert.equal(
    await servico.buscarContrato('ORG-CONSULTA', 'CONTRATO-CONSULTA'),
    contrato,
  );
  await assert.rejects(
    servico.buscarContrato('ORG-DIFERENTE', 'CONTRATO-CONSULTA'),
    /Contrato não encontrado para esta organização/,
  );
});

test('consulta individual retorna equipamento cancelado e rejeita identificador inexistente', async () => {
  const equipamento = {
    id: 'EQ-CONSULTA-CANCELADO',
    codigoBarrasInterno: 'COD-CONSULTA-CANCELADO',
    cancelado: true,
  };
  const servico = new ServicoEquipamentoPrisma({
    equipamento: {
      findUnique: async ({ where }) => (
        where.id === equipamento.id || where.codigoBarrasInterno === equipamento.codigoBarrasInterno
          ? equipamento
          : null
      ),
    },
  });

  assert.equal((await servico.consultarEquipamento(equipamento.id)).cancelado, true);
  await assert.rejects(
    servico.consultarEquipamento('EQ-INEXISTENTE'),
    /Equipamento não encontrado/,
  );
});

test('consulta individual de lote retorna os dados e rejeita lote inexistente', async () => {
  const lote = {
    id: 'LOTE-CONSULTA',
    equipamentos: [{ id: 'EQ-LOTE-CONSULTA' }],
  };
  const servico = new ServicoLotePrisma({
    lote: {
      findUnique: async ({ where }) => where.id === lote.id ? lote : null,
    },
  });

  assert.equal((await servico.buscarLote(lote.id)).equipamentos[0].id, 'EQ-LOTE-CONSULTA');
  await assert.rejects(servico.buscarLote('LOTE-INEXISTENTE'), /Lote não encontrado/);
});

test('criação de equipamento rejeita ano e peso inválidos antes da persistência', async () => {
  const lote = {
    id: 'LOTE-EQUIPAMENTO-INVALIDO',
    version: 0,
    cancelado: false,
    statusProcessamento: StatusLote.RECEBIDO,
    equipamentos: [],
  };
  const criacoes = [];
  const prisma = {
    $transaction: async (operacao) => operacao(prisma),
    lote: {
      findUnique: async ({ where }) => where.id === lote.id ? lote : null,
      updateMany: async () => ({ count: 1 }),
    },
    equipamento: {
      create: async ({ data }) => {
        criacoes.push(data);
        return data;
      },
    },
  };
  const servico = new ServicoLotePrisma(prisma);
  const dados = {
    id: 'EQ-EQUIPAMENTO-INVALIDO',
    codigoBarrasInterno: 'COD-EQUIPAMENTO-INVALIDO',
    tipo: TipoEquipamento.NOTEBOOK,
    marca: 'Marca',
    modelo: 'Modelo',
    anoFabricacao: new Date().getFullYear(),
    estadoFisico: EstadoFisico.BOM_ESTADO,
    pesoQuilogramas: 2,
  };

  await assert.rejects(
    servico.adicionarEquipamentoLote(lote.id, {
      ...dados,
      anoFabricacao: new Date().getFullYear() + 1,
    }),
    /ano de fabricação é inválido/i,
  );
  await assert.rejects(
    servico.adicionarEquipamentoLote(lote.id, { ...dados, pesoQuilogramas: 0 }),
    /peso deve ser maior que zero/i,
  );
  assert.equal(criacoes.length, 0);
});

test('cancelamento de lote com equipamento ativo é recusado sem apagar vínculos', async () => {
  const lote = {
    id: 'LOTE-CANCELAMENTO-TESTE',
    version: 2,
    cancelado: false,
    motivoCancelamento: null,
    equipamentos: [{ id: 'EQ-LOTE-CANCELAMENTO', cancelado: false }],
  };
  const auditorias = [];
  let atualizacoes = 0;
  const tx = {
    lote: {
      findUnique: async ({ where }) => where.id === lote.id ? structuredClone(lote) : null,
      updateMany: async ({ where, data }) => {
        atualizacoes += 1;
        if (where.version !== lote.version || lote.cancelado) return { count: 0 };
        const { version, ...campos } = data;
        Object.assign(lote, campos);
        lote.version += version.increment;
        return { count: 1 };
      },
    },
    eventoAuditoria: {
      create: async ({ data }) => {
        auditorias.push(data);
        return data;
      },
    },
  };
  const servico = new ServicoLotePrisma({
    $transaction: async (operacao) => operacao(tx),
  });

  await assert.rejects(
    servico.cancelarLote(lote.id, 'Lote cadastrado por engano'),
    /Cancele os equipamentos ainda ativos/,
  );
  assert.equal(atualizacoes, 0);
  assert.equal(lote.cancelado, false);

  lote.equipamentos[0].cancelado = true;
  await servico.cancelarLote(lote.id, 'Lote cadastrado por engano', 'usuario-teste');
  assert.equal(lote.cancelado, true);
  assert.equal(lote.motivoCancelamento, 'Lote cadastrado por engano');
  assert.equal(lote.equipamentos[0].id, 'EQ-LOTE-CANCELAMENTO');
  assert.equal(atualizacoes, 1);
  assert.equal(auditorias[0].operacao, 'CANCELAR');
});

test('observações do lote podem ser atualizadas após vinculação de equipamento e triagem', async () => {
  const lote = {
    id: 'LOTE-OBSERVACOES',
    dataEntrada: new Date('2026-11-15T12:00:00.000Z'),
    organizacaoId: 'ORG-LOTE',
    notaFiscal: 'NF-001',
    transportadora: 'Transportadora',
    statusProcessamento: StatusLote.TRIAGEM_CONCLUIDA,
    observacoes: 'Observação anterior',
    cancelado: false,
    version: 3,
    equipamentos: [{ id: 'EQ-LOTE' }],
  };
  const auditorias = [];
  const atualizacoes = [];
  const tx = {
    lote: {
      findUnique: async ({ where }) => where.id === lote.id ? structuredClone(lote) : null,
      updateMany: async ({ where, data }) => {
        atualizacoes.push({ where, data });
        if (where.version !== lote.version || lote.cancelado) return { count: 0 };
        const { version, ...campos } = data;
        Object.assign(lote, campos);
        lote.version += version.increment;
        return { count: 1 };
      },
    },
    eventoAuditoria: {
      create: async ({ data }) => {
        auditorias.push(data);
        return data;
      },
    },
  };
  const servico = new ServicoLotePrisma({
    $transaction: async (operacao) => operacao(tx),
  });

  const atualizado = await servico.atualizarLote(lote.id, {
    observacoes: '  Nota complementar  ',
  }, 'usuario-teste');

  assert.equal(atualizado.observacoes, 'Nota complementar');
  assert.equal(atualizado.version, 4);
  assert.equal(atualizacoes.length, 1);
  assert.equal('statusProcessamento' in atualizacoes[0].where, false);
  assert.equal(auditorias[0].dadosAntes.observacoes, 'Observação anterior');
  assert.equal(auditorias[0].dadosDepois.observacoes, 'Nota complementar');

  await assert.rejects(
    servico.atualizarLote(lote.id, { notaFiscal: 'NF-ALTERADA' }),
    /Só é possível editar um lote recebido/,
  );
  assert.equal(atualizacoes.length, 1);
});

test('atualização cadastral versionada permite edição após triagem e registra auditoria completa', async () => {
  const equipamento = {
    id: 'EQ-ATUALIZACAO',
    codigoBarrasInterno: 'COD-ATUALIZACAO',
    tipo: TipoEquipamento.NOTEBOOK,
    marca: 'Marca antiga',
    modelo: 'Modelo antigo',
    anoFabricacao: 2020,
    estadoFisico: EstadoFisico.BOM_ESTADO,
    pesoQuilogramas: 2,
    loteId: 'LOTE-ATUALIZACAO',
    posicaoNoLote: 1,
    statusRastreamento: StatusRastreamento.EM_TRIAGEM,
    cancelado: false,
    version: 4,
    movimentacoes: [{ id: 'MOV-ANTIGA' }],
  };
  const lote = {
    id: equipamento.loteId,
    cancelado: false,
    statusProcessamento: StatusLote.TRIAGEM_CONCLUIDA,
  };
  const auditoria = [];
  const tx = {
    equipamento: {
      findUnique: async ({ where }) => where.id === equipamento.id ? structuredClone(equipamento) : null,
      updateMany: async ({ where, data }) => {
        if (where.version !== equipamento.version || equipamento.cancelado) return { count: 0 };
        const { version, ...campos } = data;
        Object.assign(equipamento, campos);
        equipamento.version += version.increment;
        return { count: 1 };
      },
    },
    lote: {
      findUnique: async ({ where }) => where.id === lote.id ? lote : null,
    },
    eventoAuditoria: {
      create: async ({ data }) => {
        auditoria.push(data);
        return data;
      },
    },
  };
  const prisma = { $transaction: async (operacao) => operacao(tx) };
  const servico = new ServicoEquipamentoPrisma(prisma);

  const atualizado = await servico.atualizarEquipamento('EQ-ATUALIZACAO', {
    version: 4,
    tipo: TipoEquipamento.IMPRESSORA,
    marca: '  Marca nova  ',
    modelo: 'Modelo novo',
    anoFabricacao: 2022,
    pesoQuilogramas: 4.5,
  }, 'usuario-teste');

  assert.equal(atualizado.tipo, TipoEquipamento.IMPRESSORA);
  assert.equal(atualizado.marca, 'Marca nova');
  assert.equal(atualizado.modelo, 'Modelo novo');
  assert.equal(atualizado.anoFabricacao, 2022);
  assert.equal(atualizado.pesoQuilogramas, 4.5);
  assert.equal(atualizado.version, 5);
  assert.deepEqual(auditoria[0].dadosAntes, {
    id: equipamento.id,
    tipo: TipoEquipamento.NOTEBOOK,
    marca: 'Marca antiga',
    modelo: 'Modelo antigo',
    anoFabricacao: 2020,
    pesoQuilogramas: 2,
  });
  assert.deepEqual(auditoria[0].dadosDepois, {
    id: equipamento.id,
    tipo: TipoEquipamento.IMPRESSORA,
    marca: 'Marca nova',
    modelo: 'Modelo novo',
    anoFabricacao: 2022,
    pesoQuilogramas: 4.5,
  });
});

test('atualização cadastral rejeita versão obsoleta e conflito ocorrido durante a gravação', async () => {
  const criarCenario = (forcarConflitoNaGravacao = false) => {
    const equipamento = {
      id: 'EQ-VERSAO',
      codigoBarrasInterno: 'COD-VERSAO',
      tipo: TipoEquipamento.NOTEBOOK,
      marca: 'Marca',
      modelo: 'Modelo',
      anoFabricacao: 2020,
      estadoFisico: EstadoFisico.BOM_ESTADO,
      pesoQuilogramas: 2,
      loteId: 'LOTE-VERSAO',
      posicaoNoLote: 1,
      statusRastreamento: StatusRastreamento.AGUARDANDO_TRIAGEM,
      cancelado: false,
      version: 4,
      movimentacoes: [],
    };
    let gravacoes = 0;
    const tx = {
      equipamento: {
        findUnique: async ({ where }) => where.id === equipamento.id ? equipamento : null,
        updateMany: async () => {
          gravacoes += 1;
          if (forcarConflitoNaGravacao) return { count: 0 };
          return { count: 1 };
        },
      },
      lote: {
        findUnique: async () => ({
          id: equipamento.loteId,
          cancelado: false,
          statusProcessamento: StatusLote.RECEBIDO,
        }),
      },
      eventoAuditoria: { create: async ({ data }) => data },
    };
    return {
      equipamento,
      gravacoes: () => gravacoes,
      servico: new ServicoEquipamentoPrisma({
        $transaction: async (operacao) => operacao(tx),
      }),
    };
  };

  const versaoObsoleta = criarCenario();
  await assert.rejects(
    versaoObsoleta.servico.atualizarEquipamento('EQ-VERSAO', { version: 3, marca: 'Nova' }),
    /conflito de versão/i,
  );
  assert.equal(versaoObsoleta.gravacoes(), 0);

  const concorrencia = criarCenario(true);
  await assert.rejects(
    concorrencia.servico.atualizarEquipamento('EQ-VERSAO', { version: 4, marca: 'Nova' }),
    /conflito de atualização/i,
  );
  assert.equal(concorrencia.gravacoes(), 1);
});

test('cancelamento de equipamento preserva registro, vínculo e histórico de eventos', async () => {
  const equipamento = {
    id: 'EQ-CANCELAMENTO',
    codigoBarrasInterno: 'COD-CANCELAMENTO',
    tipo: TipoEquipamento.NOTEBOOK,
    marca: 'Marca',
    modelo: 'Modelo',
    anoFabricacao: 2020,
    estadoFisico: EstadoFisico.BOM_ESTADO,
    pesoQuilogramas: 2,
    loteId: 'LOTE-CANCELAMENTO',
    posicaoNoLote: 1,
    statusRastreamento: StatusRastreamento.EM_TRIAGEM,
    cancelado: false,
    motivoCancelamento: null,
    version: 2,
  };
  const lote = { id: equipamento.loteId, cancelado: false };
  const movimentacoes = [];
  const auditoria = [];
  const prisma = {
    $transaction: async (operacao) => operacao(prisma),
    registroRecuperacao: { count: async () => 0 },
    falhaEquipamento: { count: async () => 0 },
    equipamento: {
      findUnique: async ({ where }) => where.id === equipamento.id ? equipamento : null,
      updateMany: async ({ where, data }) => {
        if (where.id !== equipamento.id
          || where.version !== equipamento.version
          || where.cancelado !== false) return { count: 0 };
        const { version, ...campos } = data;
        Object.assign(equipamento, campos);
        equipamento.version += version.increment;
        return { count: 1 };
      },
    },
    lote: {
      findUnique: async ({ where }) => where.id === lote.id ? lote : null,
    },
    movimentacao: {
      create: async ({ data }) => {
        movimentacoes.push(data);
        return data;
      },
    },
    eventoAuditoria: {
      create: async ({ data }) => {
        auditoria.push(data);
        return data;
      },
    },
  };
  const servico = new ServicoEquipamentoPrisma(prisma);

  await servico.cancelarEquipamento(equipamento.id, 'Cadastro duplicado', 'usuario-teste');

  assert.equal(equipamento.cancelado, true);
  assert.equal(equipamento.motivoCancelamento, 'Cadastro duplicado');
  assert.equal(equipamento.statusRastreamento, StatusRastreamento.EM_TRIAGEM);
  assert.equal(equipamento.version, 3);
  assert.equal(movimentacoes.length, 1);
  assert.equal(movimentacoes[0].tipoEvento, 'CANCELAMENTO');
  assert.equal(movimentacoes[0].observacao, 'Cadastro cancelado. Motivo: Cadastro duplicado');
  assert.equal(auditoria.length, 1);
  assert.equal(auditoria[0].operacao, 'CANCELAR');
  assert.deepEqual(auditoria[0].dadosDepois, {
    id: equipamento.id,
    cancelado: true,
    motivo: 'Cadastro duplicado',
  });
  assert.equal((await servico.consultarEquipamento(equipamento.id)).cancelado, true);
  await assert.rejects(
    servico.cancelarEquipamento(equipamento.id, 'Outro motivo', 'usuario-teste'),
    /cancelado/i,
  );
  assert.equal(movimentacoes.length, 1);
});

test('exclusão física remove equipamento, movimentações e auditoria relacionadas na transação', async () => {
  const equipamento = {
    id: 'EQ-EXCLUSAO',
    codigoBarrasInterno: 'COD-EXCLUSAO',
    loteId: 'LOTE-EXCLUSAO',
  };
  const equipamentos = new Map([[equipamento.id, equipamento]]);
  const movimentacoes = new Map([
    ['MOV-EXCLUSAO-1', {
      id: 'MOV-EXCLUSAO-1',
      equipamentoId: equipamento.id,
      movimentacaoReferenciadaId: null,
    }],
    ['MOV-EXCLUSAO-2', {
      id: 'MOV-EXCLUSAO-2',
      equipamentoId: equipamento.id,
      movimentacaoReferenciadaId: 'MOV-EXCLUSAO-1',
    }],
  ]);
  const auditorias = [
    { id: 'AUD-EQUIP-ANTES', entidade: 'equipamento', dadosAntes: { id: equipamento.id }, dadosDepois: null },
    { id: 'AUD-EQUIP-DEPOIS', entidade: 'equipamento', dadosAntes: null, dadosDepois: { id: equipamento.id } },
    { id: 'AUD-OUTRO-EQUIP', entidade: 'equipamento', dadosAntes: null, dadosDepois: { id: 'EQ-OUTRO' } },
    { id: 'AUD-LOTE', entidade: 'lote', dadosAntes: null, dadosDepois: { id: equipamento.id } },
  ];
  const operacoes = [];
  const prisma = {
    $transaction: async (operacao) => operacao(prisma),
    registroRecuperacao: { count: async () => 0 },
    falhaEquipamento: { count: async () => 0 },
    equipamento: {
      findUnique: async ({ where }) => (
        where.id !== undefined
          ? equipamentos.get(where.id) ?? null
          : [...equipamentos.values()].find((item) => item.codigoBarrasInterno === where.codigoBarrasInterno) ?? null
      ),
      delete: async ({ where }) => {
        operacoes.push('excluir-equipamento');
        return equipamentos.delete(where.id);
      },
    },
    movimentacao: {
      findMany: async ({ where }) => [...movimentacoes.values()]
        .filter((item) => item.equipamentoId === where.equipamentoId)
        .map((item) => ({ id: item.id })),
      findFirst: async ({ where }) => [...movimentacoes.values()].find((item) => (
        item.equipamentoId !== where.equipamentoId.not
        && where.movimentacaoReferenciadaId.in.includes(item.movimentacaoReferenciadaId)
      )) ?? null,
      updateMany: async ({ where, data }) => {
        for (const item of movimentacoes.values()) {
          if (item.equipamentoId === where.equipamentoId && item.movimentacaoReferenciadaId !== null) {
            item.movimentacaoReferenciadaId = data.movimentacaoReferenciadaId;
          }
        }
        operacoes.push('desvincular-movimentacoes');
        return { count: 1 };
      },
      deleteMany: async ({ where }) => {
        for (const [id, item] of movimentacoes) {
          if (item.equipamentoId === where.equipamentoId) movimentacoes.delete(id);
        }
        operacoes.push('excluir-movimentacoes');
        return { count: 2 };
      },
    },
    eventoAuditoria: {
      deleteMany: async ({ where }) => {
        const correspondeAoEquipamento = (evento) => where.OR.some((filtro) => (
          (filtro.identificadorAnterior !== undefined
            && filtro.identificadorAnterior === evento.identificadorAnterior)
          || (filtro.dadosAntes?.equals !== undefined
            && filtro.dadosAntes.equals === evento.dadosAntes?.id)
          || (filtro.dadosDepois?.equals !== undefined
            && filtro.dadosDepois.equals === evento.dadosDepois?.id)
        ));
        const idsRemovidos = auditorias
          .filter((evento) => evento.entidade === where.entidade && correspondeAoEquipamento(evento))
          .map((evento) => evento.id);
        for (let indice = auditorias.length - 1; indice >= 0; indice -= 1) {
          if (idsRemovidos.includes(auditorias[indice].id)) auditorias.splice(indice, 1);
        }
        operacoes.push('excluir-auditorias');
        return { count: idsRemovidos.length };
      },
    },
  };
  const servico = new ServicoEquipamentoPrisma(prisma);

  await servico.excluirEquipamento(equipamento.id, 'Remoção solicitada');

  assert.equal(equipamentos.has(equipamento.id), false);
  assert.equal(movimentacoes.size, 0);
  assert.deepEqual(auditorias.map((evento) => evento.id), ['AUD-OUTRO-EQUIP', 'AUD-LOTE']);
  assert.deepEqual(operacoes, [
    'desvincular-movimentacoes',
    'excluir-movimentacoes',
    'excluir-auditorias',
    'excluir-equipamento',
  ]);
});

test('exclusão física recusa referências de movimentação vindas de outro equipamento', async () => {
  const equipamento = { id: 'EQ-REFERENCIADO', codigoBarrasInterno: 'COD-REFERENCIADO' };
  let exclusoes = 0;
  const prisma = {
    $transaction: async (operacao) => operacao(prisma),
    registroRecuperacao: { count: async () => 0 },
    falhaEquipamento: { count: async () => 0 },
    equipamento: {
      findUnique: async ({ where }) => where.id === equipamento.id ? equipamento : null,
      delete: async () => {
        exclusoes += 1;
      },
    },
    movimentacao: {
      findMany: async () => [{ id: 'MOV-REFERENCIADA' }],
      findFirst: async () => ({ id: 'MOV-DE-OUTRO-EQUIPAMENTO' }),
      updateMany: async () => {
        exclusoes += 1;
      },
      deleteMany: async () => {
        exclusoes += 1;
      },
    },
    eventoAuditoria: {
      deleteMany: async () => {
        exclusoes += 1;
      },
    },
  };
  const servico = new ServicoEquipamentoPrisma(prisma);

  await assert.rejects(
    servico.excluirEquipamento(equipamento.id, 'Remoção solicitada'),
    /conflito.*outro equipamento/i,
  );
  assert.equal(exclusoes, 0);
});

test('serviço Prisma de autenticação protege gestão de credenciais e não publica hashes', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const prefixo = `PRISMA-SERVICE-${randomUUID()}`;
  const administradorId = `${prefixo}-ADMIN`;
  const usuarioAdministrador = `${prefixo}-admin`;
  const servico = new ServicoAutenticacaoPrisma(prisma);
  const salt = randomUUID();
  const usuarioIds = [];

  try {
    await prisma.$connect();
    await prisma.credencial.create({
      data: {
        id: administradorId,
        usuario: usuarioAdministrador,
        nomeExibicao: 'Admin de teste',
        hashSenha: 'hash-de-teste',
        salt,
        ultimoAcesso: new Date(),
        papel: PapelUsuario.ADMINISTRADOR,
      },
    });

    const usuario = await servico.criarCredencial(
      `${prefixo}-auditor`,
      'senha-inicial',
      PapelUsuario.AUDITOR,
      'Auditor de teste',
      administradorId,
    );
    assert.equal(usuario.papel, PapelUsuario.AUDITOR);
    usuarioIds.push(usuario.id);
    const credencialNova = await prisma.credencial.findUnique({ where: { id: usuario.id } });
    assert.match(credencialNova.hashSenha, /^\$2[aby]\$12\$/);
    assert.equal(credencialNova.salt, null);
    await assert.rejects(
      servico.criarCredencial(`${prefixo}-sem-autorizacao`, 'senha', PapelUsuario.AUDITOR),
      /sessão administrativa/i,
    );
    const usuarioConcorrente = `${prefixo}-concorrente`;
    const criacoesConcorrentes = await Promise.allSettled([
      servico.criarCredencial(usuarioConcorrente, 'senha-1', PapelUsuario.AUDITOR, usuarioConcorrente, administradorId),
      servico.criarCredencial(usuarioConcorrente, 'senha-2', PapelUsuario.AUDITOR, usuarioConcorrente, administradorId),
    ]);
    const criadasConcorrentemente = criacoesConcorrentes.filter((resultado) => resultado.status === 'fulfilled');
    assert.equal(criadasConcorrentemente.length, 1);
    if (criadasConcorrentemente[0].status === 'fulfilled') {
      usuarioIds.push(criadasConcorrentemente[0].value.id);
    }

    const credenciais = await servico.listarCredenciais(administradorId);
    assert.equal(credenciais.some((credencial) => 'hashSenha' in credencial || 'salt' in credencial), false);
    assert.equal((await servico.buscarCredencial(usuario.id, administradorId)).usuario, `${prefixo}-auditor`);

    await servico.alterarNomeExibicao(usuario.id, 'Nome atualizado', administradorId);
    await servico.redefinirSenha(usuario.id, 'senha-nova', administradorId);
    assert.equal((await servico.autenticar(`${prefixo}-auditor`, 'senha-nova')).nomeExibicao, 'Nome atualizado');
    await assert.rejects(servico.autenticar(`${prefixo}-auditor`, 'senha-inicial'), /inválidos/i);

    await servico.alterarPapel(usuario.id, PapelUsuario.GESTOR_ALMOXARIFADO, administradorId);
    assert.equal(await servico.possuiPermissao(usuario.id, 'GERENCIAR_LOTES'), true);
    await servico.desativarCredencial(usuario.id, administradorId);
    await assert.rejects(servico.autenticar(`${prefixo}-auditor`, 'senha-nova'), /inválidos/i);
    const outrosAdministradoresAtivos = await prisma.credencial.count({
      where: {
        ativo: true,
        papel: PapelUsuario.ADMINISTRADOR,
        id: { not: administradorId },
      },
    });
    if (outrosAdministradoresAtivos === 0) {
      await assert.rejects(
        servico.desativarCredencial(usuarioAdministrador, administradorId),
        /último administrador/i,
      );
    } else {
      await servico.desativarCredencial(usuarioAdministrador, administradorId);
      assert.equal((await prisma.credencial.findUnique({ where: { id: administradorId } }))?.ativo, false);
    }
  } finally {
    await prisma.eventoAuditoria.deleteMany({
      where: { usuarioResponsavel: { in: [administradorId, ...usuarioIds] } },
    });
    await prisma.credencial.deleteMany({
      where: {
        OR: [
          { id: administradorId },
          { usuario: { startsWith: prefixo } },
          { id: { in: usuarioIds } },
        ],
      },
    });
    await prisma.$disconnect();
  }
});

test('serviço analítico executa os três cálculos e persiste os resultados', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  let conectado = false;
  const ids = [];

  try {
    await prisma.$connect();
    conectado = true;
    const servico = new ServicoAnaliticoPrisma(prisma);

    const eficiencia = await servico.executarEficiencia();
    const rentabilidade = await servico.executarRentabilidade();
    const vidaUtil = await servico.executarVidaUtil();
    ids.push(eficiencia.id, rentabilidade.id, vidaUtil.id);

    assert.equal(eficiencia.categoria, 'EFICIENCIA_OPERACIONAL');
    assert.equal(rentabilidade.categoria, 'RENTABILIDADE');
    assert.equal(vidaUtil.categoria, 'VIDA_UTIL_REMANESCENTE');
    assert.equal(await prisma.resultadoAnalise.count({
      where: { id: { in: [eficiencia.id, rentabilidade.id, vidaUtil.id] } },
    }), 3);
  } finally {
    if (conectado) {
      await prisma.resultadoAnalise.deleteMany({
        where: { id: { in: ids } },
      });
    }
    await prisma.$disconnect();
  }
});

test('serviços Prisma persistem triagem e movimentações como uma jornada consistente', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const prefixo = `PRISMA-SERVICE-${randomUUID()}`;
  let conectado = false;

  try {
    await prisma.$connect();
    conectado = true;
    const organizacoes = new ServicoOrganizacaoPrisma(prisma);
    const lotes = new ServicoLotePrisma(prisma);
    const equipamentos = new ServicoEquipamentoPrisma(prisma, lotes);

    const cnpjConcorrente = gerarCnpj();
    const dadosOrganizacaoConcorrente = (id, cnpj) => ({
      id,
      razaoSocial: 'Organização concorrente',
      cnpj,
      inscricaoEstadual: 'ISENTO',
      enderecoCompleto: 'Endereço de teste',
      telefone: '0000000000',
      email: 'prisma-test@example.invalid',
    });
    const concorrenciaCnpj = await Promise.allSettled([
      organizacoes.cadastrarOrganizacao(
        dadosOrganizacaoConcorrente(`${prefixo}-CNPJ-A`, cnpjConcorrente),
        prefixo,
      ),
      organizacoes.cadastrarOrganizacao(
        dadosOrganizacaoConcorrente(
          `${prefixo}-CNPJ-B`,
          `${cnpjConcorrente.slice(0, 2)}.${cnpjConcorrente.slice(2, 5)}.${cnpjConcorrente.slice(5, 8)}/${cnpjConcorrente.slice(8, 12)}-${cnpjConcorrente.slice(12)}`,
        ),
        prefixo,
      ),
    ]);
    assert.equal(concorrenciaCnpj.filter((resultado) => resultado.status === 'fulfilled').length, 1);
    assert.equal(
      await prisma.organizacao.count({ where: { cnpjNormalizado: cnpjConcorrente } }),
      1,
    );

    await organizacoes.cadastrarOrganizacao({
      id: `${prefixo}-ORG`,
      razaoSocial: 'Organização de teste Prisma',
      cnpj: gerarCnpj(),
      inscricaoEstadual: 'ISENTO',
      enderecoCompleto: 'Endereço de teste',
      telefone: '0000000000',
      email: 'prisma-test@example.invalid',
    }, prefixo);

    const batchEquipamentos = ['A', 'B'].map((sufixo) => ({
      id: `${prefixo}-BATCH-EQUIP-${sufixo}`,
      codigoBarrasInterno: `${prefixo}-BATCH-BARCODE-${sufixo}`,
      tipo: TipoEquipamento.NOTEBOOK,
      marca: 'Marca teste',
      modelo: 'Modelo teste',
      anoFabricacao: new Date().getFullYear(),
      estadoFisico: EstadoFisico.BOM_ESTADO,
      pesoQuilogramas: 2,
    }));
    const loteComEquipamentos = await lotes.criarLoteComEquipamentos({
      id: `${prefixo}-BATCH-LOT`,
      dataEntrada: new Date(),
      organizacaoId: `${prefixo}-ORG`,
      notaFiscal: 'NF-BATCH',
      transportadora: 'Transportadora de teste',
    }, batchEquipamentos, prefixo);
    assert.deepEqual(loteComEquipamentos.equipamentos.map((item) => item.posicaoNoLote), [1, 2]);

    const loteParaRollback = `${prefixo}-ROLLBACK-LOT`;
    await assert.rejects(lotes.criarLoteComEquipamentos({
      id: loteParaRollback,
      dataEntrada: new Date(),
      organizacaoId: `${prefixo}-ORG`,
      notaFiscal: 'NF-ROLLBACK',
      transportadora: 'Transportadora de teste',
    }, [
      { ...batchEquipamentos[0], id: `${prefixo}-DUPLICATE-ID`, codigoBarrasInterno: `${prefixo}-ROLLBACK-BARCODE-A` },
      { ...batchEquipamentos[1], id: `${prefixo}-DUPLICATE-ID`, codigoBarrasInterno: `${prefixo}-ROLLBACK-BARCODE-B` },
    ], prefixo));
    assert.equal(await prisma.lote.count({ where: { id: loteParaRollback } }), 0);
    assert.equal(await prisma.equipamento.count({ where: { id: `${prefixo}-DUPLICATE-ID` } }), 0);

    const assinatura = new Date(Date.now() - 60_000);
    const vencimento = new Date(Date.now() + 30 * 86400_000);
    const relatorios = new ServicoRelatorioPrisma(prisma);
    const periodoFinanceiro = { inicio: new Date(), fim: new Date(Date.now() + 60 * 86400_000) };
    const relatorioFinanceiroAntes = await relatorios.gerarRelatorioFinanceiro(periodoFinanceiro);
    const valorMensalAntes = Number(
      /Valor mensal contratado: R\$ ([\d.]+)/.exec(relatorioFinanceiroAntes)?.[1],
    );
    assert.ok(Number.isFinite(valorMensalAntes));
    await organizacoes.cadastrarContrato(`${prefixo}-ORG`, {
      id: `${prefixo}-CONTRATO`,
      dataAssinatura: assinatura,
      dataVencimento: vencimento,
      valorMensal: 1250,
      clausulas: ['Cláusula de teste'],
    }, prefixo);
    const novoVencimento = new Date(Date.now() + 60 * 86400_000);
    await organizacoes.renovarContrato(`${prefixo}-ORG`, novoVencimento, prefixo);
    assert.equal((await organizacoes.listarContratos(`${prefixo}-ORG`))[0].historicoRenovacoes.length, 1);

    await lotes.criarLote({
      id: `${prefixo}-LOTE`,
      dataEntrada: new Date(),
      organizacaoId: `${prefixo}-ORG`,
      notaFiscal: 'NF-TESTE',
      transportadora: 'Transportadora de teste',
    }, prefixo);
    await lotes.adicionarEquipamentoLote(`${prefixo}-LOTE`, {
      id: `${prefixo}-EQUIP`,
      codigoBarrasInterno: `${prefixo}-BARCODE`,
      tipo: TipoEquipamento.NOTEBOOK,
      marca: 'Marca teste',
      modelo: 'Modelo teste',
      anoFabricacao: new Date().getFullYear(),
      estadoFisico: EstadoFisico.BOM_ESTADO,
      pesoQuilogramas: 2,
    }, prefixo);

    const loteConcorrente = `${prefixo}-CONCURRENT-LOT`;
    await lotes.criarLoteComEquipamentos({
      id: loteConcorrente,
      dataEntrada: new Date(),
      organizacaoId: `${prefixo}-ORG`,
      notaFiscal: 'NF-CONCURRENT',
      transportadora: 'Transportadora de teste',
    }, [{
      id: `${prefixo}-CONCURRENT-EQUIP-1`,
      codigoBarrasInterno: `${prefixo}-CONCURRENT-BARCODE-1`,
      tipo: TipoEquipamento.NOTEBOOK,
      marca: 'Marca teste',
      modelo: 'Modelo teste',
      anoFabricacao: new Date().getFullYear(),
      estadoFisico: EstadoFisico.BOM_ESTADO,
      pesoQuilogramas: 2,
    }], prefixo);
    const corridaAdicionarTriagem = await Promise.allSettled([
      lotes.adicionarEquipamentoLote(loteConcorrente, {
        id: `${prefixo}-CONCURRENT-EQUIP-2`,
        codigoBarrasInterno: `${prefixo}-CONCURRENT-BARCODE-2`,
        tipo: TipoEquipamento.NOTEBOOK,
        marca: 'Marca teste',
        modelo: 'Modelo teste',
        anoFabricacao: new Date().getFullYear(),
        estadoFisico: EstadoFisico.BOM_ESTADO,
        pesoQuilogramas: 2,
      }, prefixo),
      lotes.processarTriagem(loteConcorrente, prefixo),
    ]);
    assert.ok(corridaAdicionarTriagem.some((resultado) => resultado.status === 'fulfilled'));
    const loteConcorrenteAtual = await lotes.buscarLote(loteConcorrente);
    if (loteConcorrenteAtual.statusProcessamento === 'TRIAGEM_CONCLUIDA') {
      assert.ok(loteConcorrenteAtual.equipamentos.every(
        (equipamento) => equipamento.statusRastreamento === StatusRastreamento.AGUARDANDO_DESMONTE,
      ));
    } else {
      assert.ok(loteConcorrenteAtual.equipamentos.every(
        (equipamento) => equipamento.statusRastreamento === StatusRastreamento.AGUARDANDO_TRIAGEM,
      ));
    }

    await lotes.processarTriagem(`${prefixo}-LOTE`, prefixo);
    assert.equal(
      (await equipamentos.consultarEquipamento(`${prefixo}-EQUIP`)).statusRastreamento,
      StatusRastreamento.AGUARDANDO_DESMONTE,
    );
    const transicoesConcorrentes = await Promise.allSettled([
      equipamentos.atualizarStatusRastreamento(
        `${prefixo}-BARCODE`,
        StatusRastreamento.EM_DESMONTE,
        prefixo,
      ),
      equipamentos.atualizarStatusRastreamento(
        `${prefixo}-EQUIP`,
        StatusRastreamento.EM_DESMONTE,
        prefixo,
      ),
    ]);
    assert.equal(
      transicoesConcorrentes.filter((resultado) => resultado.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      await prisma.movimentacao.count({ where: { equipamentoId: `${prefixo}-EQUIP` } }),
      1,
    );
    const rastreamento = await equipamentos.rastrearEquipamento(`${prefixo}-EQUIP`);
    assert.equal(rastreamento.localizacaoAtual, '');
    assert.equal(
      rastreamento.linhaDoTempo.some((evento) => evento.tipo === 'RENOVACAO_CONTRATO'),
      true,
    );
    const periodo = { inicio: new Date(Date.now() - 86400_000), fim: new Date(Date.now() + 86400_000) };
    const quantidadeEquipamentos = await prisma.equipamento.count({
      where: { lote: { organizacaoId: `${prefixo}-ORG` }, cancelado: false },
    });
    assert.match(
      await relatorios.gerarRelatorioPorOrganizacao(`${prefixo}-ORG`, periodo),
      new RegExp(`Equipamentos nos lotes: ${quantidadeEquipamentos}`),
    );
    assert.match(
      await relatorios.gerarRelatorioFinanceiro({
        inicio: new Date(),
        fim: novoVencimento,
      }),
      new RegExp(`Valor mensal contratado: R\\$ ${(valorMensalAntes + 1250).toFixed(2)}`),
    );
    assert.match(
      await relatorios.gerarRelatorioPorStatus(StatusRastreamento.EM_DESMONTE),
      new RegExp(`${prefixo}-EQUIP`),
    );
    const relatorioAuditoria = await relatorios.gerarRelatorioAuditoria(periodo);
    assert.match(relatorioAuditoria, /RENOVAR contrato/);
    assert.match(relatorioAuditoria, /ALTERAR_STATUS equipamento/);
  } finally {
    if (conectado) {
      const encontrados = await prisma.equipamento.findMany({
        where: { id: { startsWith: prefixo } },
        select: { id: true },
      });
      const equipamentoIds = encontrados.map((item) => item.id);
      await prisma.movimentacao.deleteMany({ where: { equipamentoId: { in: equipamentoIds } } });
      await prisma.equipamento.deleteMany({ where: { id: { in: equipamentoIds } } });
      await prisma.lote.deleteMany({ where: { id: { startsWith: prefixo } } });
      await prisma.organizacao.updateMany({
        where: { id: { startsWith: prefixo } },
        data: { contratoVigenteId: null },
      });
      await prisma.contrato.deleteMany({ where: { organizacaoId: { startsWith: prefixo } } });
      await prisma.organizacao.deleteMany({ where: { id: { startsWith: prefixo } } });
      await prisma.eventoAuditoria.deleteMany({ where: { usuarioResponsavel: prefixo } });
    }
    await prisma.$disconnect();
  }
});

test('serviço de organização atualiza cláusulas, renova, cancela e encerra contratos', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const prefixo = `PRISMA-CONTRACT-${randomUUID()}`;
  const organizacaoCancelamento = `${prefixo}-ORG-CANCEL`;
  const organizacaoEncerramento = `${prefixo}-ORG-CLOSE`;
  const contratoCancelamento = `${prefixo}-CONTRACT-CANCEL`;
  const contratoEncerramento = `${prefixo}-CONTRACT-CLOSE`;
  const idsOrganizacao = [organizacaoCancelamento, organizacaoEncerramento];
  const idsContrato = [contratoCancelamento, contratoEncerramento];
  let conectado = false;
  const servico = new ServicoOrganizacaoPrisma(prisma);

  try {
    await prisma.$connect();
    conectado = true;
    for (const id of idsOrganizacao) {
      await servico.cadastrarOrganizacao({
        id,
        razaoSocial: 'Organização de teste de contrato',
        cnpj: gerarCnpj(),
        inscricaoEstadual: 'ISENTO',
        enderecoCompleto: 'Endereço de teste',
        telefone: '11999999999',
        email: 'contrato-test@example.invalid',
      }, prefixo);
    }

    const dataAssinatura = new Date(Date.now() - 86400_000);
    const dataVencimento = new Date(Date.now() + 30 * 86400_000);
    await servico.cadastrarContrato(organizacaoCancelamento, {
      id: contratoCancelamento,
      dataAssinatura,
      dataVencimento,
      valorMensal: 100,
      clausulas: ['Cláusula original'],
    }, prefixo);
    const atualizado = await servico.atualizarContrato(
      organizacaoCancelamento,
      contratoCancelamento,
      { clausulas: ['Cláusula atualizada'], valorMensal: 125 },
      prefixo,
    );
    assert.deepEqual(atualizado.clausulas, ['Cláusula atualizada']);
    assert.equal(atualizado.valorMensal, 125);

    const novoVencimento = new Date(Date.now() + 60 * 86400_000);
    const renovado = await servico.renovarContrato(
      organizacaoCancelamento,
      novoVencimento,
      prefixo,
    );
    assert.equal(renovado.dataVencimento.getTime(), novoVencimento.getTime());
    assert.equal(renovado.historicoRenovacoes.length, 1);
    await servico.cancelarContrato(organizacaoCancelamento, contratoCancelamento, prefixo);
    assert.ok((await servico.buscarContrato(organizacaoCancelamento, contratoCancelamento)).encerradoEm);
    assert.equal((await servico.buscarOrganizacao(organizacaoCancelamento)).contratoVigenteId, null);

    await servico.cadastrarContrato(organizacaoEncerramento, {
      id: contratoEncerramento,
      dataAssinatura,
      dataVencimento,
      valorMensal: 200,
    }, prefixo);
    await servico.encerrarContrato(organizacaoEncerramento, prefixo);
    assert.ok((await servico.buscarContrato(organizacaoEncerramento, contratoEncerramento)).encerradoEm);
    assert.equal((await servico.buscarOrganizacao(organizacaoEncerramento)).contratoVigenteId, null);
  } finally {
    if (conectado) {
      await prisma.organizacao.updateMany({
        where: { id: { in: idsOrganizacao } },
        data: { contratoVigenteId: null },
      });
      await prisma.eventoAuditoria.deleteMany({ where: { usuarioResponsavel: prefixo } });
      await prisma.contrato.deleteMany({ where: { id: { in: idsContrato } } });
      await prisma.organizacao.deleteMany({ where: { id: { in: idsOrganizacao } } });
    }
    await prisma.$disconnect();
  }
});

test('parâmetros globais e auditoria Prisma persistem versões em transações e geram relatórios', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const prefixo = `PRISMA-SERVICE-${randomUUID()}`;
  const administradorId = `${prefixo}-ADMIN`;
  let conectado = false;

  try {
    await prisma.$connect();
    conectado = true;
    await prisma.credencial.create({
      data: {
        id: administradorId,
        usuario: `${prefixo}-admin`,
        nomeExibicao: 'Admin de parâmetros',
        hashSenha: 'hash-de-teste',
        salt: randomUUID(),
        ultimoAcesso: new Date(),
        papel: PapelUsuario.ADMINISTRADOR,
      },
    });

    const parametros = new ServicoParametrosGlobaisPrisma(prisma);
    const auditoria = new ServicoAuditoriaPrisma(prisma);
    const relatorios = new ServicoRelatorioPrisma(prisma);
    const atualAntes = await parametros.consultar(administradorId);
    await assert.rejects(parametros.consultar(`${prefixo}-desconhecido`), /permissão/i);
    await assert.rejects(
      parametros.atualizar(administradorId, { imposto: 'ICMS', aliquota: 1.1 }, 'teste'),
      /entre 0 e 1/i,
    );

    const primeiraVersao = await parametros.atualizar(
      administradorId,
      { imposto: ' icms ', aliquota: 0.18, coeficienteDepreciacao: 0.1 },
      `${prefixo}-responsavel`,
    );
    const segundaVersao = await parametros.atualizar(
      administradorId,
      { imposto: 'ISS', aliquota: 0.05 },
      `${prefixo}-responsavel`,
    );
    assert.equal(primeiraVersao.versao, atualAntes.versao + 1);
    assert.equal(segundaVersao.versao, atualAntes.versao + 2);
    assert.deepEqual(segundaVersao.aliquotasImpostos, { ICMS: 0.18, ISS: 0.05 });
    assert.deepEqual(
      (await parametros.listarHistorico(administradorId)).slice(-2).map((item) => item.versao),
      [atualAntes.versao + 1, atualAntes.versao + 2],
    );
    const impostosConcorrentes = ['A', 'B', 'C'].map((sufixo) => `T${randomUUID().slice(0, 6)}${sufixo}`);
    const atualizacoesConcorrentes = await Promise.allSettled(
      impostosConcorrentes.map((imposto, indice) => parametros.atualizar(
        administradorId,
        { imposto, aliquota: (indice + 1) / 100 },
        `${prefixo}-responsavel`,
      )),
    );
    const versoesConcorrentes = atualizacoesConcorrentes
      .filter((resultado) => resultado.status === 'fulfilled');
    const conflitosConcorrentes = atualizacoesConcorrentes
      .filter((resultado) => resultado.status === 'rejected');
    assert.ok(versoesConcorrentes.length > 0);
    assert.ok(conflitosConcorrentes.every((resultado) => /conflito/i.test(resultado.reason.message)));
    const taxasPersistidas = (await parametros.consultar(administradorId)).aliquotasImpostos;
    const impostosAceitos = atualizacoesConcorrentes
      .flatMap((resultado, indice) => resultado.status === 'fulfilled'
        ? [impostosConcorrentes[indice].toUpperCase()]
        : []);
    assert.ok(
      impostosAceitos.every((imposto) => imposto in taxasPersistidas),
      JSON.stringify({ impostosAceitos, taxasPersistidas }),
    );
    assert.equal(
      await auditoria.executar({
        operacao: 'TESTE_AUDITORIA',
        entidade: 'teste',
        usuarioResponsavel: administradorId,
        dadosDepois: { resultado: 'persistido' },
      }, async () => 'ok'),
      'ok',
    );

    const inicio = new Date(Date.now() - 60_000);
    const fim = new Date(Date.now() + 60_000);
    const auditoriaAntes = await auditoria.listar({ inicio, fim });
    const relatorioAuditoria = await relatorios.gerarRelatorioAuditoria({ inicio, fim });
    assert.match(relatorioAuditoria, /Relatório de auditoria/);
    assert.match(relatorioAuditoria, /ATUALIZAR parametros-globais/);
    assert.match(relatorioAuditoria, /TESTE_AUDITORIA teste/);
    assert.match(
      await relatorios.gerarRelatorioFinanceiro({ inicio, fim }),
      /Transações auditadas no período: \d+/,
    );

    const eventosAntesDoErro = await prisma.eventoAuditoria.count({
      where: { usuarioResponsavel: administradorId, timestamp: { gte: inicio, lte: fim } },
    });
    await assert.rejects(auditoria.executar(
      {
        operacao: 'TESTE_COM_FALHA',
        entidade: 'teste',
        usuarioResponsavel: administradorId,
      },
      async () => {
        throw new Error('falha simulada');
      },
    ), /falha simulada/);
    assert.equal(
      await prisma.eventoAuditoria.count({
        where: { usuarioResponsavel: administradorId, timestamp: { gte: inicio, lte: fim } },
      }),
      eventosAntesDoErro,
    );
  } finally {
    if (conectado) {
      await prisma.eventoAuditoria.deleteMany({ where: { usuarioResponsavel: administradorId } });
      await prisma.parametroGlobal.deleteMany({ where: { atualizadoPor: `${prefixo}-responsavel` } });
      await prisma.credencial.deleteMany({ where: { id: administradorId } });
    }
    await prisma.$disconnect();
  }
});
