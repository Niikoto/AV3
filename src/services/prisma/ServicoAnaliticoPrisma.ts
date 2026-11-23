import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { CategoriaAnalise, EstadoFisico, TipoEquipamento } from '../../generated/prisma/enums.js';

export type PeriodoAnalise = {
  inicio?: Date;
  fim?: Date;
  organizacaoId?: string;
};

export type ResultadoEficiencia = {
  amostras: number;
  tempoMedioHoras: number | null;
  porOrganizacao: Array<{ organizacaoId: string; amostras: number; tempoMedioHoras: number | null }>;
  porOperador: Array<{ operador: string; amostras: number; tempoMedioHoras: number | null }>;
};

export type ResultadoRentabilidade = {
  amostras: number;
  valorRecuperacaoEstimadoDisponivel: false;
  valorRecuperacaoObservadoDisponivel: boolean;
  categorias: Array<{
    tipo: TipoEquipamento;
    marca: string;
    modelo: string;
    estadoFisico: EstadoFisico;
    amostras: number;
    referenciaDepreciacaoMedia: number | null;
    recuperacaoObservada: Array<{ moeda: string; amostras: number; total: number; mediaPorRegistro: number }>;
  }>;
};

export type ResultadoVidaUtil = {
  amostras: number;
  categorias: Array<{
    tipo: TipoEquipamento;
    amostrasHistoricas: number;
    metodo: 'REGRESSAO_LINEAR';
    equipamentosHistoricos: number;
    falhasObservadas: number;
    idadeRemanescenteAnos: number | null;
    dataEstimadaInservivel: string | null;
    estimativaConfiavel: boolean;
  }>;
};

const ordemEstado: Record<EstadoFisico, number> = {
  NOVO: 0,
  BOM_ESTADO: 1,
  USADO_LEVE: 2,
  USADO_MODERADO: 3,
  DANIFICADO_LEVE: 4,
  DANIFICADO_GRAVE: 5,
  INSERVIVEL: 6,
};

export function calcularMedia(valores: number[]): number | null {
  if (valores.length === 0) return null;
  return Number((valores.reduce((total, valor) => total + valor, 0) / valores.length).toFixed(2));
}

export function calcularRegressaoLinear(pontos: Array<{ x: number; y: number }>): {
  inclinacao: number;
  intercepto: number;
} | null {
  if (pontos.length < 2) return null;
  const mediaX = pontos.reduce((total, ponto) => total + ponto.x, 0) / pontos.length;
  const mediaY = pontos.reduce((total, ponto) => total + ponto.y, 0) / pontos.length;
  const denominador = pontos.reduce((total, ponto) => total + (ponto.x - mediaX) ** 2, 0);
  if (denominador === 0) return null;
  const inclinacao = pontos.reduce(
    (total, ponto) => total + (ponto.x - mediaX) * (ponto.y - mediaY),
    0,
  ) / denominador;
  return { inclinacao, intercepto: mediaY - inclinacao * mediaX };
}

export class ServicoAnaliticoPrisma {
  constructor(private prisma: PrismaClient) {}

  async executarEficiencia(periodo: PeriodoAnalise = {}, idempotenciaId?: string) {
    this.validarPeriodo(periodo);
    const lotes = await this.prisma.lote.findMany({
      where: {
        cancelado: false,
        ...(periodo.organizacaoId ? { organizacaoId: periodo.organizacaoId } : {}),
        dataEntrada: this.filtroPeriodo(periodo),
        dataConclusaoTriagem: { not: null },
      },
      select: {
        id: true,
        organizacaoId: true,
        dataEntrada: true,
        dataConclusaoTriagem: true,
      },
    });

    const duracoes = lotes.flatMap((lote) => {
      if (!lote.dataConclusaoTriagem) return [];
      return [Math.max(0, (lote.dataConclusaoTriagem.getTime() - lote.dataEntrada.getTime()) / 3_600_000)];
    });
    const operadores = await this.operadoresDaTriagem(lotes);
    const porOrganizacao = this.agrupar(lotes.flatMap((lote) => {
      if (!lote.dataConclusaoTriagem) return [];
      return [{
        chave: lote.organizacaoId,
        valor: (lote.dataConclusaoTriagem.getTime() - lote.dataEntrada.getTime()) / 3_600_000,
      }];
    }));
    const porOperador = this.agrupar(operadores);

    const resultado: ResultadoEficiencia = {
      amostras: lotes.length,
      tempoMedioHoras: calcularMedia(duracoes),
      porOrganizacao: porOrganizacao.map((item) => ({
        organizacaoId: item.chave,
        amostras: item.valores.length,
        tempoMedioHoras: calcularMedia(item.valores),
      })),
      porOperador: porOperador.map((item) => ({
        operador: item.chave,
        amostras: item.valores.length,
        tempoMedioHoras: calcularMedia(item.valores),
      })),
    };

    return this.persistir(
      CategoriaAnalise.EFICIENCIA_OPERACIONAL,
      periodo,
      'DIFERENCA_HORAS_ENTRADA_CONCLUSAO_TRIAGEM',
      resultado,
      resultado.amostras === 0
        ? ['Nenhum lote possui data de entrada e conclusão de triagem no período selecionado.']
        : ['Tempo calculado em horas; lotes sem conclusão ou cancelados foram excluídos.',
          'Comparação por operador disponível apenas para eventos de conclusão registrados na auditoria.',
        ],
      idempotenciaId,
    );
  }

  async executarRentabilidade(periodo: PeriodoAnalise = {}, idempotenciaId?: string) {
    this.validarPeriodo(periodo);
    const equipamentos = await this.prisma.equipamento.findMany({
      where: {
        cancelado: false,
        lote: {
          cancelado: false,
          ...(periodo.organizacaoId ? { organizacaoId: periodo.organizacaoId } : {}),
          dataEntrada: this.filtroPeriodo(periodo),
        },
      },
      select: {
        tipo: true,
        marca: true,
        modelo: true,
        estadoFisico: true,
        anoFabricacao: true,
        pesoQuilogramas: true,
        recuperacoes: {
          where: this.filtroPeriodo(periodo)
            ? { dataRecuperacao: this.filtroPeriodo(periodo) }
            : {},
          select: { valorRecuperado: true, moeda: true },
        },
      },
    });

    const parametro = await this.prisma.parametroGlobal.findFirst({
      orderBy: { versao: 'desc' },
      select: { coeficienteDepreciacao: true },
    });
    const coeficiente = parametro?.coeficienteDepreciacao ?? 0.08;
    const anoAtual = new Date().getFullYear();
    const grupos = new Map<string, {
      tipo: TipoEquipamento;
      marca: string;
      modelo: string;
      estadoFisico: EstadoFisico;
      referencias: number[];
      recuperacoesPorMoeda: Map<string, number[]>;
    }>();

    for (const equipamento of equipamentos) {
      const chave = `${equipamento.tipo}|${equipamento.marca}|${equipamento.modelo}|${equipamento.estadoFisico}`;
      const grupo = grupos.get(chave) ?? {
        tipo: equipamento.tipo,
        marca: equipamento.marca,
        modelo: equipamento.modelo,
        estadoFisico: equipamento.estadoFisico,
        referencias: [],
        recuperacoesPorMoeda: new Map<string, number[]>(),
      };
      const anos = Math.max(0, anoAtual - equipamento.anoFabricacao);
      grupo.referencias.push(equipamento.pesoQuilogramas * anos * coeficiente);
      for (const recuperacao of equipamento.recuperacoes) {
        const valores = grupo.recuperacoesPorMoeda.get(recuperacao.moeda) ?? [];
        valores.push(Number(recuperacao.valorRecuperado));
        grupo.recuperacoesPorMoeda.set(recuperacao.moeda, valores);
      }
      grupos.set(chave, grupo);
    }

    const temRecuperacaoObservada = Array.from(grupos.values())
      .some((grupo) => grupo.recuperacoesPorMoeda.size > 0);

    const resultado: ResultadoRentabilidade = {
      amostras: equipamentos.length,
      valorRecuperacaoEstimadoDisponivel: false,
      valorRecuperacaoObservadoDisponivel: temRecuperacaoObservada,
      categorias: Array.from(grupos.values()).map((grupo) => ({
        tipo: grupo.tipo,
        marca: grupo.marca,
        modelo: grupo.modelo,
        estadoFisico: grupo.estadoFisico,
        amostras: grupo.referencias.length,
        referenciaDepreciacaoMedia: calcularMedia(grupo.referencias),
        recuperacaoObservada: Array.from(grupo.recuperacoesPorMoeda.entries())
          .sort(([moedaA], [moedaB]) => moedaA.localeCompare(moedaB))
          .map(([moeda, valores]) => ({
            moeda,
            amostras: valores.length,
            total: Number(valores.reduce((soma, valor) => soma + valor, 0).toFixed(2)),
            mediaPorRegistro: calcularMedia(valores) ?? 0,
          })),
      })),
    };

    return this.persistir(
      CategoriaAnalise.RENTABILIDADE,
      periodo,
      'AGRUPAMENTO_POR_TIPO_MARCA_MODELO_ESTADO_COM_RECUPERACAO_OBSERVADA_E_REFERENCIA_DE_DEPRECIACAO',
      resultado,
      [
        temRecuperacaoObservada
          ? 'Valores de recuperação são observações registradas; totais são separados por moeda e não representam lucro líquido.'
          : 'Nenhum valor real de recuperação foi registrado no período; somente a referência de depreciação está disponível.',
        'A referência de depreciação não é valor monetário nem rentabilidade financeira garantida.',
      ],
      idempotenciaId,
    );
  }

  async executarVidaUtil(periodo: PeriodoAnalise = {}, idempotenciaId?: string) {
    this.validarPeriodo(periodo);
    const equipamentos = await this.prisma.equipamento.findMany({
      where: {
        cancelado: false,
        lote: {
          cancelado: false,
          ...(periodo.organizacaoId ? { organizacaoId: periodo.organizacaoId } : {}),
          dataEntrada: this.filtroPeriodo(periodo),
        },
      },
      include: {
        movimentacoes: {
          where: { tipoEvento: 'ESTADO_FISICO' },
          orderBy: [{ dataHora: 'asc' }, { id: 'asc' }],
        },
        falhas: {
          where: { dataHora: { lte: periodo.fim ?? new Date() } },
          orderBy: [{ dataHora: 'asc' }, { id: 'asc' }],
          select: { dataHora: true, estadoFisico: true },
        },
      },
    });

    const grupos = new Map<TipoEquipamento, Array<{ x: number; y: number; equipamentoId: string; falha: boolean }>>();
    for (const equipamento of equipamentos) {
      const pontos = grupos.get(equipamento.tipo) ?? [];
      for (const movimentacao of equipamento.movimentacoes) {
        if (!(movimentacao.destino in ordemEstado)) continue;
        const estado = movimentacao.destino as EstadoFisico;
        const idadeNaObservacao = movimentacao.dataHora.getFullYear() - equipamento.anoFabricacao;
        if (idadeNaObservacao >= 0) {
          pontos.push({ x: idadeNaObservacao, y: ordemEstado[estado], equipamentoId: equipamento.id, falha: false });
        }
      }
      for (const falha of equipamento.falhas) {
        const idadeNaFalha = falha.dataHora.getFullYear() - equipamento.anoFabricacao;
        if (idadeNaFalha >= 0) {
          pontos.push({
            x: idadeNaFalha,
            y: ordemEstado[falha.estadoFisico],
            equipamentoId: equipamento.id,
            falha: true,
          });
        }
      }
      const idadeAtual = new Date().getFullYear() - equipamento.anoFabricacao;
      if (idadeAtual >= 0) {
        pontos.push({
          x: idadeAtual,
          y: ordemEstado[equipamento.estadoFisico],
          equipamentoId: equipamento.id,
          falha: false,
        });
      }
      if (pontos.length > 0) grupos.set(equipamento.tipo, pontos);
    }

    const categorias: ResultadoVidaUtil['categorias'] = [];
    for (const tipo of Array.from(grupos.keys()).sort()) {
      const pontos = grupos.get(tipo) ?? [];
      const regressao = calcularRegressaoLinear(pontos);
      const idadeAtualPorEquipamento = new Map<string, number>();
      for (const ponto of pontos) {
        idadeAtualPorEquipamento.set(ponto.equipamentoId, Math.max(
          idadeAtualPorEquipamento.get(ponto.equipamentoId) ?? 0,
          ponto.x,
        ));
      }
      const equipamentosHistoricos = idadeAtualPorEquipamento.size;
      const idadeAtualMedia = equipamentosHistoricos === 0 ? 0
        : Array.from(idadeAtualPorEquipamento.values()).reduce((total, idade) => total + idade, 0) / equipamentosHistoricos;
      let idadeRemanescenteAnos: number | null = null;
      let dataEstimadaInservivel: string | null = null;
      let estimativaConfiavel = false;

      if (regressao && regressao.inclinacao > 0) {
        const idadeInservivel = (ordemEstado.INSERVIVEL - regressao.intercepto) / regressao.inclinacao;
        const remanescente = idadeInservivel - idadeAtualMedia;
        if (Number.isFinite(remanescente) && remanescente >= 0) {
          idadeRemanescenteAnos = Number(remanescente.toFixed(2));
          const data = new Date();
          data.setFullYear(data.getFullYear() + Math.ceil(remanescente));
          dataEstimadaInservivel = data.toISOString();
          estimativaConfiavel = equipamentosHistoricos >= 3;
        }
      }

      categorias.push({
        tipo,
        amostrasHistoricas: pontos.length,
        metodo: 'REGRESSAO_LINEAR',
        equipamentosHistoricos,
        falhasObservadas: pontos.filter((ponto) => ponto.falha).length,
        idadeRemanescenteAnos,
        dataEstimadaInservivel,
        estimativaConfiavel,
      });
    }

    const resultado: ResultadoVidaUtil = {
      amostras: equipamentos.length,
      categorias,
    };

    return this.persistir(
      CategoriaAnalise.VIDA_UTIL_REMANESCENTE,
      periodo,
      'MINIMOS_QUADRADOS_ORDINARIOS_SOBRE_IDADE_X_ESTADO_FISICO',
      resultado,
      [
        'Previsões são estimativas, não garantias.',
        'A regressão usa estados físicos registrados e eventos de falha com o estado observado; estimativa confiável exige pelo menos três equipamentos distintos.',
        'As observações repetidas do mesmo equipamento contribuem para a inclinação, mas não aumentam a contagem de equipamentos independentes.',
      ],
      idempotenciaId,
    );
  }

  async listar(categoria?: CategoriaAnalise, limite = 50, organizacaoId?: string) {
    return this.prisma.resultadoAnalise.findMany({
      where: {
        ...(categoria ? { categoria } : {}),
        ...(organizacaoId ? { organizacaoId } : {}),
      },
      orderBy: { realizadaEm: 'desc' },
      take: Math.min(Math.max(limite, 1), 200),
    });
  }

  async buscarPorId(id: string) {
    return this.prisma.resultadoAnalise.findUnique({ where: { id } });
  }

  private validarPeriodo(periodo: PeriodoAnalise) {
    if (periodo.inicio && periodo.fim && periodo.inicio > periodo.fim) {
      throw new Error('A data inicial não pode ser posterior à data final.');
    }
  }

  private filtroPeriodo(periodo: PeriodoAnalise): Prisma.DateTimeFilter | undefined {
    if (!periodo.inicio && !periodo.fim) return undefined;
    return {
      ...(periodo.inicio ? { gte: periodo.inicio } : {}),
      ...(periodo.fim ? { lte: periodo.fim } : {}),
    };
  }

  private async operadoresDaTriagem(lotes: Array<{
    id: string;
    dataEntrada: Date;
    dataConclusaoTriagem: Date | null;
  }>) {
    if (lotes.length === 0) return [];
    const loteIdSet = new Set(lotes.map((lote) => lote.id));
    const duracoesPorLote = new Map(lotes.flatMap((lote) => {
      if (!lote.dataConclusaoTriagem) return [];
      return [[lote.id, (lote.dataConclusaoTriagem.getTime() - lote.dataEntrada.getTime()) / 3_600_000] as const];
    }));
    const eventos = await this.prisma.eventoAuditoria.findMany({
      where: { operacao: 'CONCLUIR_TRIAGEM', entidade: 'lote' },
      select: { usuarioResponsavel: true, dadosDepois: true },
    });
    return eventos.flatMap((evento) => {
      if (!this.jsonObjeto(evento.dadosDepois)) return [];
      const dados = evento.dadosDepois as Prisma.JsonObject;
      const loteId = typeof dados.id === 'string' ? dados.id : undefined;
      if (!loteId || !loteIdSet.has(loteId)) return [];
      const duracao = duracoesPorLote.get(loteId);
      return duracao === undefined ? [] : [{ chave: evento.usuarioResponsavel, valor: duracao }];
    });
  }

  private agrupar<T extends { chave: string; valor: number }>(itens: T[]) {
    const grupos = new Map<string, number[]>();
    for (const item of itens) {
      const valores = grupos.get(item.chave) ?? [];
      valores.push(item.valor);
      grupos.set(item.chave, valores);
    }
    return Array.from(grupos.entries()).map(([chave, valores]) => ({ chave, valores }));
  }

  private jsonObjeto(valor: Prisma.JsonValue | null): valor is Prisma.JsonObject {
    return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
  }

  private async persistir(
    categoria: CategoriaAnalise,
    periodo: PeriodoAnalise,
    metodo: string,
    resultados: unknown,
    observacoes: string[],
    idempotenciaId?: string,
  ) {
    const data = {
      id: idempotenciaId ?? randomUUID(),
      categoria,
      periodoInicio: periodo.inicio,
      periodoFim: periodo.fim,
      organizacaoId: periodo.organizacaoId,
      metodo,
      resultados: resultados as Prisma.InputJsonValue,
      observacoes,
    };
    if (!idempotenciaId) return this.prisma.resultadoAnalise.create({ data });

    const { id, ...dadosAtualizacao } = data;
    return this.prisma.resultadoAnalise.upsert({
      where: { id },
      create: data,
      update: dadosAtualizacao,
    });
  }
}
