import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { EstadoFisico, TipoFalhaEquipamento } from '../../generated/prisma/enums.js';
import { ServicoAuditoriaPrisma } from './ServicoAuditoriaPrisma.js';

export class ServicoFalhaEquipamentoPrisma {
  constructor(private prisma: PrismaClient) {}

  async registrar(equipamentoId: string, dados: {
    tipo: TipoFalhaEquipamento;
    dataHora: Date;
    estadoFisico: EstadoFisico;
    descricao: string;
  }, responsavel: string) {
    if (!Object.values(TipoFalhaEquipamento).includes(dados.tipo)) {
      throw new Error('O tipo de falha informado é inválido.');
    }
    if (!Object.values(EstadoFisico).includes(dados.estadoFisico)) {
      throw new Error('O estado físico observado na falha é inválido.');
    }
    if (!dados.descricao.trim() || !responsavel.trim()) {
      throw new Error('Descrição da falha e responsável são obrigatórios.');
    }
    if (Number.isNaN(dados.dataHora.getTime()) || dados.dataHora > new Date()) {
      throw new Error('A data da falha é inválida ou futura.');
    }

    return this.prisma.$transaction(async (tx) => {
      const equipamento = await tx.equipamento.findUnique({
        where: { id: equipamentoId },
        include: { lote: { select: { cancelado: true } } },
      });
      if (!equipamento || equipamento.cancelado) throw new Error('Equipamento ativo não encontrado.');
      if (equipamento.lote.cancelado) throw new Error('O lote associado está cancelado.');
      if (dados.dataHora.getFullYear() < equipamento.anoFabricacao) {
        throw new Error('A data da falha não pode ser anterior à fabricação do equipamento.');
      }
      const falha = await tx.falhaEquipamento.create({
        data: {
          id: randomUUID(),
          equipamentoId,
          tipo: dados.tipo,
          dataHora: dados.dataHora,
          estadoFisico: dados.estadoFisico,
          descricao: dados.descricao.trim(),
          responsavel: responsavel.trim(),
        },
      });
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'REGISTRAR_FALHA_EQUIPAMENTO',
        entidade: 'falha_equipamento',
        dadosDepois: {
          id: falha.id,
          equipamentoId,
          tipo: falha.tipo,
          dataHora: falha.dataHora.toISOString(),
          estadoFisico: falha.estadoFisico,
          descricao: falha.descricao,
        },
        usuarioResponsavel: responsavel,
      });
      return falha;
    });
  }

  async listar(equipamentoId: string) {
    return this.prisma.falhaEquipamento.findMany({
      where: { equipamentoId },
      orderBy: [{ dataHora: 'desc' }, { id: 'asc' }],
    });
  }
}
