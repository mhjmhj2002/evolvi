import { prisma } from '../../infrastructure/database/prisma.js';
import { normalizarCestaCategorias } from '../categoria/categoria-normalization.service.js';
import { configuracaoService } from '../usuario/configuracao.service.js';
import {
  BaselineResponse,
  SemaforoResponse,
  CategoriaSemaforoItem,
  SemaforoStatusType,
} from './fase1.schema.js';

/**
 * Retorna os últimos N meses fechados a partir de uma competência de referência (exclusiva).
 * Ex: Se ref = '2026-10', os últimos 6 meses fechados são ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].
 */
export function calcularUltimosMesesFechados(
  competenciaReferencia?: string,
  nMeses = 6
): string[] {
  let ano: number;
  let mes: number;

  if (competenciaReferencia) {
    const [anoStr, mesStr] = competenciaReferencia.split('-');
    ano = parseInt(anoStr, 10);
    mes = parseInt(mesStr, 10);
  } else {
    const agora = new Date();
    ano = agora.getFullYear();
    mes = agora.getMonth() + 1; // 1-indexed mês corrente em aberto
  }

  const meses: string[] = [];

  for (let i = 1; i <= nMeses; i++) {
    let targetMes = mes - i;
    let targetAno = ano;

    while (targetMes < 1) {
      targetMes += 12;
      targetAno -= 1;
    }

    meses.unshift(`${targetAno}-${String(targetMes).padStart(2, '0')}`);
  }

  return meses;
}

/**
 * Classifica a diferença percentual (delta em pontos percentuais) na régua de semáforo canônica:
 * - VERDE: delta < -5 p.p.
 * - AMARELO: -5 p.p. <= delta <= +5 p.p.
 * - VERMELHO: delta > +5 p.p.
 */
export function classificarSemaforo(diferencaPp: number): SemaforoStatusType {
  if (diferencaPp < -5.0) {
    return 'VERDE';
  }
  if (diferencaPp > 5.0) {
    return 'VERMELHO';
  }
  return 'AMARELO';
}

export class BaselineService {
  /**
   * Calcula o diagnóstico Baseline das despesas reais de consumo.
   * Utiliza a janela configurada do usuário (3 a 12 meses, padrão 6) caso não fornecida explicitamente.
   */
  async calcularBaseline(
    usuarioId: string,
    competenciaReferencia?: string,
    mesesJanela?: number
  ): Promise<BaselineResponse> {
    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { rendaBaseMensal: true },
    });

    const rendaBase = usuario ? Number(usuario.rendaBaseMensal) : 0;
    const nMesesEfetivo =
      mesesJanela && mesesJanela >= 3 && mesesJanela <= 12
        ? mesesJanela
        : await configuracaoService.obterMesesJanelaUsuario(usuarioId);

    const mesesAnalisados = calcularUltimosMesesFechados(competenciaReferencia, nMesesEfetivo);

    // Buscar categorias raízes da POF (categoriaPaiId: null)
    const categoriasRaiz = await prisma.categoria.findMany({
      where: {
        categoriaPaiId: null,
        OR: [{ usuarioId: null }, { usuarioId }],
      },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    });

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

    // Buscar despesas conciliadas do usuário nos meses da janela N=6 (incluindo possíveis rateios analíticos)
    const movimentosDespesa = await prisma.movimento.findMany({
      where: {
        usuarioId,
        competencia: { in: mesesAnalisados },
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

    // Acumular despesas por categoria raiz
    const totalPorCategoriaRaiz = new Map<string, number>();
    for (const raiz of categoriasRaiz) {
      totalPorCategoriaRaiz.set(raiz.id, 0);
    }

    let totalPeriodo = 0;
    for (const mov of movimentosDespesa) {
      const valorTotalMov = Number(mov.valor);
      totalPeriodo += valorTotalMov;

      // Se houver rateios definidos para o movimento, acumulamos pelas categorias dos splits
      if (mov.rateios && mov.rateios.length > 0) {
        for (const rat of mov.rateios) {
          const valSplit = Number(rat.valor);
          const raizId = subParaRaizMap.get(rat.categoriaId);
          if (raizId && totalPorCategoriaRaiz.has(raizId)) {
            totalPorCategoriaRaiz.set(
              raizId,
              (totalPorCategoriaRaiz.get(raizId) || 0) + valSplit
            );
          }
        }
      } else if (mov.categoriaId) {
        const raizId = subParaRaizMap.get(mov.categoriaId);
        if (raizId && totalPorCategoriaRaiz.has(raizId)) {
          totalPorCategoriaRaiz.set(
            raizId,
            (totalPorCategoriaRaiz.get(raizId) || 0) + valorTotalMov
          );
        }
      }
    }

    const nMeses = mesesAnalisados.length || 6;
    const mediaMensalTotal = Number((totalPeriodo / nMeses).toFixed(2));
    const gapZeroAZero = Number((mediaMensalTotal - rendaBase).toFixed(2));

    const pctExcessoRenda =
      rendaBase > 0
        ? Number(((gapZeroAZero / rendaBase) * 100).toFixed(2))
        : 0;

    const detalhesCategorias = categoriasRaiz.map((raiz) => {
      const tot = Number((totalPorCategoriaRaiz.get(raiz.id) || 0).toFixed(2));
      const med = Number((tot / nMeses).toFixed(2));
      return {
        categoria_id: raiz.id,
        nome: raiz.nome,
        total_periodo: tot,
        media_mensal: med,
      };
    });

    return {
      renda_base: rendaBase,
      meses_analisados: mesesAnalisados,
      total_periodo: Number(totalPeriodo.toFixed(2)),
      media_mensal: mediaMensalTotal,
      gap_zero_a_zero: gapZeroAZero,
      pct_excesso_renda: pctExcessoRenda,
      detalhes_categorias: detalhesCategorias,
    };
  }

  /**
   * Gera a matriz semafórica comparando o gasto real de cada categoria contra o benchmark POF normalizado a 100%.
   */
  async calcularSemaforo(
    usuarioId: string,
    competenciaReferencia?: string,
    mesesJanela?: number
  ): Promise<SemaforoResponse> {
    const baseline = await this.calcularBaseline(usuarioId, competenciaReferencia, mesesJanela);

    // Buscar categorias raízes com pesos brutos
    const categoriasRaiz = await prisma.categoria.findMany({
      where: {
        categoriaPaiId: null,
        OR: [{ usuarioId: null }, { usuarioId }],
      },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    });

    // Normalizar pesos de referência da cesta para fechar estritamente em 100.00%
    const formatadas = categoriasRaiz.map((c) => ({
      ...c,
      pesoBrutoReferencia: c.pesoBrutoReferencia !== null ? Number(c.pesoBrutoReferencia) : 0,
      referenciaNormalizadaPct:
        c.referenciaNormalizadaPct !== null ? Number(c.referenciaNormalizadaPct) : 0,
    }));
    const normalizadas = normalizarCestaCategorias(formatadas);

    const normalizadaMap = new Map<string, number>();
    for (const cat of normalizadas) {
      normalizadaMap.set(cat.id, cat.referenciaNormalizadaPct);
    }

    const mediaMensalTotal = baseline.media_mensal;

    const categoriasSemaforo: CategoriaSemaforoItem[] = normalizadas.map((cat) => {
      const detalhe = baseline.detalhes_categorias.find((d) => d.categoria_id === cat.id);
      const gastoMedio = detalhe ? detalhe.media_mensal : 0;

      // % Gasto Atual em relação ao total de consumo da média N=6
      const pctGastoAtual =
        mediaMensalTotal > 0
          ? Number(((gastoMedio / mediaMensalTotal) * 100).toFixed(2))
          : 0;

      const refNormPct = normalizadaMap.get(cat.id) ?? 0;
      const diferencaPp = Number((pctGastoAtual - refNormPct).toFixed(2));
      const statusSemaforo = classificarSemaforo(diferencaPp);

      return {
        categoria_id: cat.id,
        nome: cat.nome,
        ordem: cat.ordem ?? 0,
        gasto_medio_mensal: gastoMedio,
        pct_gasto_atual: pctGastoAtual,
        referencia_normalizada_pct: refNormPct,
        diferenca_pp: diferencaPp,
        status_semaforo: statusSemaforo,
      };
    });

    return {
      total_categorias: categoriasSemaforo.length,
      renda_base: baseline.renda_base,
      media_mensal_total: mediaMensalTotal,
      meses_analisados: baseline.meses_analisados,
      categorias: categoriasSemaforo,
    };
  }
}

export const baselineService = new BaselineService();
