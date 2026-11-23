import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { ServicoAuditoriaPrisma } from './ServicoAuditoriaPrisma.js';

export type DadosRecuperacao = {
  material: string;
  valorRecuperado: number;
  moeda?: string;
  dataRecuperacao: Date;
  origem: string;
  observacao?: string;
};

export class ServicoRecuperacaoPrisma {
  constructor(private prisma: PrismaClient) {}

  async registrar(equipamentoId: string, dados: DadosRecuperacao, responsavel: string) {
    const material = dados.material.trim();
    const origem = dados.origem.trim();
    const moeda = (dados.moeda ?? 'BRL').trim().toUpperCase();
    if (!material || !origem || !responsavel.trim()) {
      throw new Error('Material, origem e responsável são obrigatórios.');
    }
    if (!Number.isFinite(dados.valorRecuperado) || dados.valorRecuperado <= 0
      || dados.valorRecuperado > 9_999_999_999.99
      || Math.abs(dados.valorRecuperado * 100 - Math.round(dados.valorRecuperado * 100)) > 1e-8) {
      throw new Error('O valor recuperado deve ser positivo, conter no máximo duas casas decimais e caber no limite monetário aceito.');
    }
    if (!/^[A-Z]{3}$/.test(moeda)) throw new Error('Informe a moeda no formato ISO de três letras.');
    if (Number.isNaN(dados.dataRecuperacao.getTime()) || dados.dataRecuperacao > new Date()) {
      throw new Error('A data de recuperação é inválida ou futura.');
    }

    return this.prisma.$transaction(async (tx) => {
      const equipamento = await tx.equipamento.findUnique({
        where: { id: equipamentoId },
        include: { lote: { select: { cancelado: true } } },
      });
      if (!equipamento || equipamento.cancelado) throw new Error('Equipamento ativo não encontrado.');
      if (equipamento.lote.cancelado) throw new Error('O lote associado está cancelado.');
      const registro = await tx.registroRecuperacao.create({
        data: {
          id: randomUUID(),
          equipamentoId,
          material,
          valorRecuperado: dados.valorRecuperado,
          moeda,
          dataRecuperacao: dados.dataRecuperacao,
          origem,
          observacao: dados.observacao?.trim() ?? '',
          responsavel: responsavel.trim(),
        },
      });
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'REGISTRAR_RECUPERACAO',
        entidade: 'recuperacao',
        dadosDepois: {
          id: registro.id,
          equipamentoId,
          material: registro.material,
          valorRecuperado: registro.valorRecuperado.toString(),
          moeda: registro.moeda,
          dataRecuperacao: registro.dataRecuperacao.toISOString(),
          origem: registro.origem,
        },
        usuarioResponsavel: responsavel,
      });
      return registro;
    });
  }

  async listar(equipamentoId: string) {
    return this.prisma.registroRecuperacao.findMany({
      where: { equipamentoId },
      orderBy: [{ dataRecuperacao: 'desc' }, { id: 'asc' }],
    });
  }
}
