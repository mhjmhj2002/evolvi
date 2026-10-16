import { prisma } from '../../infrastructure/database/prisma.js';
import { baselineService } from './baseline.service.js';
import {
  PlanoMetasResponse,
  ExecucaoMetasResponse,
  MetaItemResponse,
  ExecucaoMetaItem,
  salvarMetasZeroAZeroSchema,
} from './fase1.schema.js';
import { z } from 'zod';

export type SalvarMetasInput = z.infer<typeof salvarMetasZeroAZeroSchema>;

export class MetasZeroAZeroService {
  /**
   * Obtém a competência corrente default no formato YYYY-MM.
   */
  obterCompetenciaAtual(): string {
    const agora = new Date();
    const ano = agora.getFullYear();
    const mes = String(agora.getMonth() + 1).padStart(2, '0');
    return `${ano}-${mes}`;
  }

  /**
   * Retorna as metas estipuladas para a competência informada (ou competência atual / PLANO_PADRAO).
   * Se nenhuma meta persistida existir para a competência ou plano padrão, monta a sugestão inicial
   * a partir do diagnóstico do Baseline N=6 e da Matriz de Semáforo.
   */
  async obterMetas(
    usuarioId: string,
    competenciaParam?: string
  ): Promise<PlanoMetasResponse> {
    const competenciaAlvo = competenciaParam || this.obterCompetenciaAtual();

    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { rendaBaseMensal: true },
    });
    const rendaBase = usuario ? Number(usuario.rendaBaseMensal) : 0;

    // Buscar metas salvas para a competência alvo
    let metasSalvas = await prisma.metaZeroAZero.findMany({
      where: {
        usuarioId,
        competencia: competenciaAlvo,
      },
      include: {
        categoria: {
          select: {
            id: true,
            nome: true,
            ordem: true,
          },
        },
      },
      orderBy: [
        { categoria: { ordem: 'asc' } },
        { categoria: { nome: 'asc' } },
      ],
    });

    // Se não houver metas para a competência e a competência não for PLANO_PADRAO,
    // tenta carregar as metas do PLANO_PADRAO
    let competenciaEfetiva = competenciaAlvo;
    if (metasSalvas.length === 0 && competenciaAlvo !== 'PLANO_PADRAO') {
      const metasPlanoPadrao = await prisma.metaZeroAZero.findMany({
        where: {
          usuarioId,
          competencia: 'PLANO_PADRAO',
        },
        include: {
          categoria: {
            select: {
              id: true,
              nome: true,
              ordem: true,
            },
          },
        },
        orderBy: [
          { categoria: { ordem: 'asc' } },
          { categoria: { nome: 'asc' } },
        ],
      });

      if (metasPlanoPadrao.length > 0) {
        metasSalvas = metasPlanoPadrao;
        competenciaEfetiva = 'PLANO_PADRAO';
      }
    }

    // Se já existem metas salvas (seja da competência ou do plano padrão), formata e calcula totais
    if (metasSalvas.length > 0) {
      let totalBaseline = 0;
      let totalMeta = 0;
      let totalReducao = 0;

      const metasFormatadas: MetaItemResponse[] = metasSalvas.map((m) => {
        const base = Number(m.baselineMensal);
        const meta = Number(m.metaProposta);
        const red = Number(m.reducaoProposta !== null ? m.reducaoProposta : (base - meta).toFixed(2));

        totalBaseline += base;
        totalMeta += meta;
        totalReducao += red;

        return {
          id: m.id,
          categoria_id: m.categoriaId,
          nome_categoria: m.categoria.nome,
          ordem: m.categoria.ordem ?? 0,
          baseline_mensal: base,
          meta_proposta: meta,
          reducao_proposta: red,
          condicao_acao: m.condicaoAcao,
          status_semaforo: m.statusSemaforo,
        };
      });

      const totalMetaArredondada = Number(totalMeta.toFixed(2));
      const gapPosMeta = Number(Math.max(0, totalMetaArredondada - rendaBase).toFixed(2));
      const equacionado = totalMetaArredondada <= rendaBase;

      return {
        competencia: competenciaAlvo,
        renda_base: rendaBase,
        total_baseline: Number(totalBaseline.toFixed(2)),
        total_meta_proposta: totalMetaArredondada,
        total_reducao_proposta: Number(totalReducao.toFixed(2)),
        gap_pos_meta: gapPosMeta,
        equacionado,
        metas: metasFormatadas,
      };
    }

    // Se não há nenhuma meta salva, constrói sugestão baseada no Baseline N=6 e Semáforo
    const semaforo = await baselineService.calcularSemaforo(
      usuarioId,
      competenciaAlvo !== 'PLANO_PADRAO' ? competenciaAlvo : undefined
    );

    let totalBaseline = 0;
    let totalMeta = 0;
    let totalReducao = 0;

    const metasSugeridas: MetaItemResponse[] = semaforo.categorias.map((cat) => {
      const base = cat.gasto_medio_mensal;
      // Por default, a meta proposta inicial reflete o baseline até que o usuário planeje a redução
      const meta = base;
      const red = 0.0;

      totalBaseline += base;
      totalMeta += meta;
      totalReducao += red;

      return {
        categoria_id: cat.categoria_id,
        nome_categoria: cat.nome,
        ordem: cat.ordem,
        baseline_mensal: base,
        meta_proposta: meta,
        reducao_proposta: red,
        condicao_acao: null,
        status_semaforo: cat.status_semaforo,
      };
    });

    const totalMetaArredondada = Number(totalMeta.toFixed(2));
    const gapPosMeta = Number(Math.max(0, totalMetaArredondada - rendaBase).toFixed(2));
    const equacionado = totalMetaArredondada <= rendaBase;

    return {
      competencia: competenciaAlvo,
      renda_base: rendaBase,
      total_baseline: Number(totalBaseline.toFixed(2)),
      total_meta_proposta: totalMetaArredondada,
      total_reducao_proposta: Number(totalReducao.toFixed(2)),
      gap_pos_meta: gapPosMeta,
      equacionado,
      metas: metasSugeridas,
    };
  }

  /**
   * Salva ou atualiza em lote as metas do Zero a Zero por categoria para uma competência ou PLANO_PADRAO.
   * Regra de Equacionamento Inegociável:
   * A soma de todas as metas propostas DEVE ser <= Renda Base, garantindo Gap pós-meta = R$ 0,00.
   */
  async salvarMetas(usuarioId: string, input: SalvarMetasInput): Promise<PlanoMetasResponse> {
    const competenciaAlvo = input.competencia || this.obterCompetenciaAtual();

    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { rendaBaseMensal: true },
    });

    const rendaBase = usuario ? Number(usuario.rendaBaseMensal) : 0;

    // Calcular a soma das metas propostas
    const somaMetasPropostas = input.metas.reduce(
      (acc, item) => acc + item.metaProposta,
      0
    );
    const somaMetasArredondada = Number(somaMetasPropostas.toFixed(2));

    // Validação da regra de equacionamento
    if (somaMetasArredondada > rendaBase) {
      const diferencaExcesso = Number((somaMetasArredondada - rendaBase).toFixed(2));
      throw new Error(
        `Plano rejeitado: A soma das metas propostas (R$ ${somaMetasArredondada.toFixed(2)}) ultrapassa a Renda Base mensal (R$ ${rendaBase.toFixed(2)}) em R$ ${diferencaExcesso.toFixed(2)}. O plano do Zero a Zero exige que a soma das metas seja menor ou igual à Renda Base (Gap pós-meta = R$ 0,00).`
      );
    }

    // Buscar dados do Baseline N=6 e Semáforo para saber o baseline e o status_semaforo de cada categoria
    const semaforo = await baselineService.calcularSemaforo(
      usuarioId,
      competenciaAlvo !== 'PLANO_PADRAO' ? competenciaAlvo : undefined
    );

    const semaforoMap = new Map<
      string,
      {
        gastoMedio: number;
        statusSemaforo: 'VERDE' | 'AMARELO' | 'VERMELHO';
        nome: string;
        ordem: number;
      }
    >();

    for (const c of semaforo.categorias) {
      semaforoMap.set(c.categoria_id, {
        gastoMedio: c.gasto_medio_mensal,
        statusSemaforo: c.status_semaforo,
        nome: c.nome,
        ordem: c.ordem,
      });
    }

    // Validar se todas as categorias fornecidas existem e pertencem às raízes válidas
    const categoriasIds = input.metas.map((m) => m.categoriaId);
    const categoriasExistentes = await prisma.categoria.findMany({
      where: {
        id: { in: categoriasIds },
        categoriaPaiId: null,
        OR: [{ usuarioId: null }, { usuarioId }],
      },
      select: { id: true },
    });

    const existentesSet = new Set(categoriasExistentes.map((c) => c.id));
    for (const meta of input.metas) {
      if (!existentesSet.has(meta.categoriaId)) {
        throw new Error(
          `Categoria ID '${meta.categoriaId}' não encontrada ou não é uma categoria raiz válida para o planejamento.`
        );
      }
    }

    // Persistir as metas atomicamente via transação
    await prisma.$transaction(async (tx) => {
      for (const meta of input.metas) {
        const catInfo = semaforoMap.get(meta.categoriaId);
        const baselineMensal = catInfo ? catInfo.gastoMedio : 0.0;
        const statusSemaforo = catInfo ? catInfo.statusSemaforo : 'AMARELO';
        const reducaoProposta = Number((baselineMensal - meta.metaProposta).toFixed(2));

        await tx.metaZeroAZero.upsert({
          where: {
            usuarioId_categoriaId_competencia: {
              usuarioId,
              categoriaId: meta.categoriaId,
              competencia: competenciaAlvo,
            },
          },
          update: {
            baselineMensal,
            metaProposta: meta.metaProposta,
            reducaoProposta,
            condicaoAcao: meta.condicaoAcao ?? null,
            statusSemaforo,
          },
          create: {
            usuarioId,
            categoriaId: meta.categoriaId,
            competencia: competenciaAlvo,
            baselineMensal,
            metaProposta: meta.metaProposta,
            reducaoProposta,
            condicaoAcao: meta.condicaoAcao ?? null,
            statusSemaforo,
          },
        });
      }
    });

    // Retorna o plano atualizado
    return this.obterMetas(usuarioId, competenciaAlvo);
  }

  /**
   * Compara a meta estipulada vs o gasto real executado na competência.
   * Apura desvios (superávit de economia ou estouro de meta) por categoria em tempo real.
   */
  async obterExecucao(
    usuarioId: string,
    competencia: string
  ): Promise<ExecucaoMetasResponse> {
    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { rendaBaseMensal: true },
    });
    const rendaBase = usuario ? Number(usuario.rendaBaseMensal) : 0;

    // Buscar as metas da competência (ou PLANO_PADRAO se não existirem específicas)
    const plano = await this.obterMetas(usuarioId, competencia);

    // Mapear todas as categorias (incluindo subcategorias) para sua categoria raiz correspondente
    const todasCategorias = await prisma.categoria.findMany({
      where: {
        OR: [{ usuarioId: null }, { usuarioId }],
      },
      select: {
        id: true,
        categoriaPaiId: true,
      },
    });

    const subParaRaizMap = new Map<string, string>();
    for (const cat of todasCategorias) {
      if (!cat.categoriaPaiId) {
        subParaRaizMap.set(cat.id, cat.id);
      } else {
        subParaRaizMap.set(cat.id, cat.categoriaPaiId);
      }
    }

    // Buscar os gastos reais da competência informada (incluindo possíveis rateios)
    const movimentosDespesa = await prisma.movimento.findMany({
      where: {
        usuarioId,
        competencia,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
      },
      select: {
        id: true,
        categoriaId: true,
        valor: true,
        rateios: {
          select: {
            categoriaId: true,
            valor: true,
          },
        },
      },
    });

    // Acumular gastos reais por categoria raiz
    const gastosReaisPorRaiz = new Map<string, number>();
    let totalRealizado = 0;

    for (const mov of movimentosDespesa) {
      const valorTotal = Number(mov.valor);
      totalRealizado += valorTotal;

      if (mov.rateios && mov.rateios.length > 0) {
        for (const r of mov.rateios) {
          const raizId = subParaRaizMap.get(r.categoriaId);
          if (raizId) {
            gastosReaisPorRaiz.set(
              raizId,
              (gastosReaisPorRaiz.get(raizId) || 0) + Number(r.valor)
            );
          }
        }
      } else if (mov.categoriaId) {
        const raizId = subParaRaizMap.get(mov.categoriaId);
        if (raizId) {
          gastosReaisPorRaiz.set(
            raizId,
            (gastosReaisPorRaiz.get(raizId) || 0) + valorTotal
          );
        }
      }
    }

    // Comparar cada meta estipulada com o realizado
    let totalMeta = 0;

    const itensExecucao: ExecucaoMetaItem[] = plano.metas.map((m) => {
      const metaValor = m.meta_proposta;
      totalMeta += metaValor;

      const realizado = Number((gastosReaisPorRaiz.get(m.categoria_id) || 0).toFixed(2));
      const desvio = Number((metaValor - realizado).toFixed(2));
      const pctAtingimento =
        metaValor > 0
          ? Number(((realizado / metaValor) * 100).toFixed(2))
          : realizado > 0
          ? 100.0
          : 0.0;

      const situacao: 'DENTRO_DA_META' | 'ESTOURO_DE_META' =
        realizado <= metaValor ? 'DENTRO_DA_META' : 'ESTOURO_DE_META';

      return {
        categoria_id: m.categoria_id,
        nome_categoria: m.nome_categoria,
        ordem: m.ordem,
        meta_proposta: metaValor,
        gasto_realizado: realizado,
        desvio,
        pct_atingimento: pctAtingimento,
        situacao,
        condicao_acao: m.condicao_acao,
      };
    });

    const totalRealizadoArredondado = Number(totalRealizado.toFixed(2));
    const totalMetaArredondada = Number(totalMeta.toFixed(2));
    const desvioTotal = Number((totalMetaArredondada - totalRealizadoArredondado).toFixed(2));
    const saldoDisponivelMes = Number((rendaBase - totalRealizadoArredondado).toFixed(2));

    return {
      competencia,
      renda_base: rendaBase,
      total_meta: totalMetaArredondada,
      total_realizado: totalRealizadoArredondado,
      desvio_total: desvioTotal,
      saldo_disponivel_mes: saldoDisponivelMes,
      categorias: itensExecucao,
    };
  }
}

export const metasZeroAZeroService = new MetasZeroAZeroService();
