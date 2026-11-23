import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { PermissaoApi } from '../../generated/prisma/enums.js';

export type ContextoParceiro = {
  chaveId: string;
  parceiroId: string;
  parceiroNome: string;
  organizacaoId: string;
  permissoes: PermissaoApi[];
};

export class ServicoApiPublicaPrisma {
  constructor(private prisma: PrismaClient) {}

  async criarParceiro(nome: string, organizacaoId: string) {
    const nomeLimpo = nome.trim();
    if (!nomeLimpo) throw new Error('O nome do parceiro é obrigatório.');
    if (!await this.prisma.organizacao.findUnique({ where: { id: organizacaoId } })) {
      throw new Error('Organização não encontrada.');
    }
    return this.prisma.parceiroApi.create({
      data: { id: randomUUID(), nome: nomeLimpo, organizacaoId },
    });
  }

  async criarChave(
    parceiroId: string,
    permissoes: PermissaoApi[],
    expiraEm?: Date,
  ): Promise<{ chave: string; registro: {
    id: string;
    prefixo: string;
    permissoes: PermissaoApi[];
    expiraEm: Date | null;
  } }> {
    if (!permissoes.length) throw new Error('Informe ao menos uma permissão para a chave.');
    if (expiraEm && expiraEm <= new Date()) throw new Error('A data de expiração deve ser futura.');

    const parceiro = await this.prisma.parceiroApi.findUnique({ where: { id: parceiroId } });
    if (!parceiro) throw new Error('Parceiro não encontrado.');
    if (!parceiro.ativo) throw new Error('O parceiro está desativado.');

    const segredo = `gc_live_${randomBytes(32).toString('base64url')}`;
    const hashSecret = this.hash(segredo);
    const registro = await this.prisma.chaveApi.create({
      data: {
        id: randomUUID(),
        parceiroId,
        prefixo: segredo.slice(0, 12),
        hashSecret,
        permissoes,
        expiraEm,
      },
    });
    return { chave: segredo, registro };
  }

  async validarChave(segredo: string | undefined): Promise<ContextoParceiro> {
    if (!segredo?.trim()) throw new Error('Chave de API ausente.');
    if (!segredo.startsWith('gc_live_')) throw new Error('Chave de API inválida.');

    const chave = await this.prisma.chaveApi.findUnique({
      where: { hashSecret: this.hash(segredo) },
      include: {
        parceiro: true,
      },
    });
    if (!chave || !chave.ativa || chave.revogadaEm) throw new Error('Chave de API inválida ou revogada.');
    if (chave.expiraEm && chave.expiraEm <= new Date()) throw new Error('Chave de API expirada.');
    if (!chave.parceiro.ativo) throw new Error('Parceiro desativado.');

    await this.prisma.chaveApi.update({
      where: { id: chave.id },
      data: { ultimoUsoEm: new Date() },
    });
    return {
      chaveId: chave.id,
      parceiroId: chave.parceiroId,
      parceiroNome: chave.parceiro.nome,
      organizacaoId: chave.parceiro.organizacaoId,
      permissoes: chave.permissoes,
    };
  }

  exigirPermissao(contexto: ContextoParceiro, permissao: PermissaoApi): void {
    if (!contexto.permissoes.includes(permissao)) {
      throw new Error('A chave de API não possui permissão para esta operação.');
    }
  }

  async revogarChave(chaveId: string): Promise<void> {
    const chave = await this.prisma.chaveApi.findUnique({ where: { id: chaveId } });
    if (!chave) throw new Error('Chave não encontrada.');
    if (!chave.ativa) return;
    await this.prisma.chaveApi.update({
      where: { id: chaveId },
      data: { ativa: false, revogadaEm: new Date() },
    });
  }

  async listarChaves(parceiroId?: string) {
    return this.prisma.chaveApi.findMany({
      where: parceiroId ? { parceiroId } : undefined,
      select: {
        id: true,
        prefixo: true,
        permissoes: true,
        ativa: true,
        criadaEm: true,
        expiraEm: true,
        revogadaEm: true,
        ultimoUsoEm: true,
        parceiro: { select: { id: true, nome: true, organizacaoId: true, ativo: true } },
      },
      orderBy: { criadaEm: 'desc' },
    });
  }

  private hash(segredo: string): string {
    return createHash('sha256').update(segredo).digest('hex');
  }
}
