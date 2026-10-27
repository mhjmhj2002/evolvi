import { prisma } from '../../infrastructure/database/prisma.js';
import { calcularUltimosMesesFechados } from './baseline.service.js';
import { configuracaoService } from '../usuario/configuracao.service.js';
import {
  HistoricoResumoResponse,
  HistoricoCategoriasResponse,
  HistoricoFechamentoMes,
  HistoricoCategoriaItem,
  HistoricoSubcategoriaItem,
} from './historico.schema.js';

export class HistoricoConsumoService {
  /**
   * Obtém a competência aberta de referência (se não informada, ano-mês atual)
   */
  private obterCompetenciaAberta(competenciaReferencia?: string): string {
    if (competenciaReferencia) {
      return competenciaReferencia;
    }
    const agora = new Date();
    const ano = agora.getFullYear();
    const mes = String(agora.getMonth() + 1).padStart(2, '0');
    return `${ano}-${mes}`;
  }

  /**
   * Consolida o resumo do histórico dos últimos N meses fechados (M-004)
   */
  async obterResumoHistorico(
    usuarioId: string,
    competenciaReferencia?: string,
    mesesJanelaParam?: number
  ): Promise<HistoricoResumoResponse> {
    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { rendaBaseMensal: true },
    });

    const rendaBase = usuario ? Number(usuario.rendaBaseMensal) : 0;
    const mesesJanela =
      mesesJanelaParam && mesesJanelaParam >= 3 && mesesJanelaParam <= 12
        ? mesesJanelaParam
        : await configuracaoService.obterMesesJanelaUsuario(usuarioId);

    const competenciaAberta = this.obterCompetenciaAberta(competenciaReferencia);
    const mesesFechados = calcularUltimosMesesFechados(competenciaReferencia, mesesJanela);

    const inicioJanela = mesesFechados[0] || competenciaAberta;
    const fimJanela = mesesFechados[mesesFechados.length - 1] || competenciaAberta;

    // Buscar todos os movimentos conciliados nos meses fechados
    // Protegendo contra dupla contagem: apenas DESPESA e RECEITA econômicas reais
    const movimentosFechados = await prisma.movimento.findMany({
      where: {
        usuarioId,
        competencia: { in: mesesFechados },
        status: 'CONCILIADO',
        natureza: { in: ['DESPESA', 'RECEITA'] },
      },
      select: {
        id: true,
        competencia: true,
        natureza: true,
        valor: true,
      },
    });

    // Mapeamento mês a mês
    const fechamentoMap = new Map<string, { despesas: number; receitas: number; qtd: number }>();
    for (const m of mesesFechados) {
      fechamentoMap.set(m, { despesas: 0, receitas: 0, qtd: 0 });
    }

    // Buscar exclusões ativas de despesas para desconsiderar da média
    const exclusoesAtivas = await prisma.exclusaoMovimentoMedia.findMany({
      where: { usuarioId, ativo: true },
      select: { movimentoId: true },
    });
    const idsExcluidosSet = new Set<string>(exclusoesAtivas.map((e) => e.movimentoId));

    let totalDespesas = 0;
    let totalReceitas = 0;
    let qtdDespesas = 0;

    for (const mov of movimentosFechados) {
      const val = Number(mov.valor);
      const reg = fechamentoMap.get(mov.competencia);
      if (mov.natureza === 'DESPESA') {
        if (idsExcluidosSet.has(mov.id)) {
          continue;
        }
        totalDespesas += val;
        qtdDespesas += 1;
        if (reg) {
          reg.despesas += val;
          reg.qtd += 1;
        }
      } else if (mov.natureza === 'RECEITA') {
        totalReceitas += val;
        if (reg) {
          reg.receitas += val;
          reg.qtd += 1;
        }
      }
    }

    const nMeses = mesesFechados.length || 1;
    const mediaMensalDespesas = Number((totalDespesas / nMeses).toFixed(2));
    const mediaMensalReceitas = Number((totalReceitas / nMeses).toFixed(2));
    const ticketMedioGlobal =
      qtdDespesas > 0 ? Number((totalDespesas / qtdDespesas).toFixed(2)) : 0;

    const fechamentosMensais: HistoricoFechamentoMes[] = mesesFechados.map((comp) => {
      const dados = fechamentoMap.get(comp) || { despesas: 0, receitas: 0, qtd: 0 };
      const desp = Number(dados.despesas.toFixed(2));
      const rec = Number(dados.receitas.toFixed(2));
      return {
        competencia: comp,
        totalDespesas: desp,
        totalReceitas: rec,
        saldoMes: Number((rec - desp).toFixed(2)),
        quantidadeLancamentos: dados.qtd,
      };
    });

    // Comparativo com o mês corrente em aberto (sem misturar nos fechamentos)
    const movimentosMesAberto = await prisma.movimento.findMany({
      where: {
        usuarioId,
        competencia: competenciaAberta,
        status: 'CONCILIADO',
        natureza: { in: ['DESPESA', 'RECEITA'] },
      },
      select: {
        natureza: true,
        valor: true,
      },
    });

    let despMesAberto = 0;
    let recMesAberto = 0;
    for (const mov of movimentosMesAberto) {
      const val = Number(mov.valor);
      if (mov.natureza === 'DESPESA') despMesAberto += val;
      if (mov.natureza === 'RECEITA') recMesAberto += val;
    }

    const despMesAbertoNum = Number(despMesAberto.toFixed(2));
    const recMesAbertoNum = Number(recMesAberto.toFixed(2));
    const diffVsMedia = Number((despMesAbertoNum - mediaMensalDespesas).toFixed(2));
    const pctAtingimento =
      mediaMensalDespesas > 0
        ? Number(((despMesAbertoNum / mediaMensalDespesas) * 100).toFixed(2))
        : 0;

    return {
      janela: {
        inicio: inicioJanela,
        fim: fimJanela,
        total_meses: nMeses,
        meses_fechados: mesesFechados,
        competencia_aberta: competenciaAberta,
      },
      renda_base_mensal: rendaBase,
      total_periodo_despesas: Number(totalDespesas.toFixed(2)),
      media_mensal_despesas: mediaMensalDespesas,
      total_periodo_receitas: Number(totalReceitas.toFixed(2)),
      media_mensal_receitas: mediaMensalReceitas,
      quantidade_total_lancamentos: qtdDespesas,
      ticket_medio_global: ticketMedioGlobal,
      fechamentos_mensais: fechamentosMensais,
      comparativo_mes_aberto: {
        competencia: competenciaAberta,
        totalDespesas: despMesAbertoNum,
        totalReceitas: recMesAbertoNum,
        diferencaDespesaVsMedia: diffVsMedia,
        pctAtingimentoMedia: pctAtingimento,
      },
    };
  }

  /**
   * Consolida a decomposição por Categoria e Subcategoria POF no Histórico (M-004)
   */
  async obterAnaliseCategorias(
    usuarioId: string,
    competenciaReferencia?: string,
    mesesJanelaParam?: number
  ): Promise<HistoricoCategoriasResponse> {
    const mesesJanela =
      mesesJanelaParam && mesesJanelaParam >= 3 && mesesJanelaParam <= 12
        ? mesesJanelaParam
        : await configuracaoService.obterMesesJanelaUsuario(usuarioId);

    const mesesFechados = calcularUltimosMesesFechados(competenciaReferencia, mesesJanela);
    const competenciaAberta = this.obterCompetenciaAberta(competenciaReferencia);
    const nMeses = mesesFechados.length || 1;

    // Buscar categorias raiz
    const categoriasRaiz = await prisma.categoria.findMany({
      where: {
        categoriaPaiId: null,
        OR: [{ usuarioId: null }, { usuarioId }],
      },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    });

    // Buscar todas as subcategorias
    const todasCategorias = await prisma.categoria.findMany({
      where: {
        OR: [{ usuarioId: null }, { usuarioId }],
      },
      select: {
        id: true,
        nome: true,
        categoriaPaiId: true,
      },
    });

    const catMap = new Map<string, { id: string; nome: string; categoriaPaiId: string | null }>();
    const subcategoriasPorRaiz = new Map<string, Array<{ id: string; nome: string }>>();

    for (const c of todasCategorias) {
      catMap.set(c.id, c);
      if (c.categoriaPaiId) {
        const subs = subcategoriasPorRaiz.get(c.categoriaPaiId) || [];
        subs.push({ id: c.id, nome: c.nome });
        subcategoriasPorRaiz.set(c.categoriaPaiId, subs);
      }
    }

    // Buscar despesas conciliadas nos meses fechados (incluindo possíveis rateios)
    const despesasFechadas = await prisma.movimento.findMany({
      where: {
        usuarioId,
        competencia: { in: mesesFechados },
        status: 'CONCILIADO',
        natureza: 'DESPESA',
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

    // Buscar despesas no mês aberto para comparativo (incluindo possíveis rateios)
    const despesasMesAberto = await prisma.movimento.findMany({
      where: {
        usuarioId,
        competencia: competenciaAberta,
        status: 'CONCILIADO',
        natureza: 'DESPESA',
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

    // Mapear totais e quantidades por subcategoria e por raiz
    const totalPorSub = new Map<string, { total: number; qtd: number }>();
    const totalPorRaiz = new Map<string, { total: number; qtd: number }>();
    const totalAbertoPorRaiz = new Map<string, number>();

    let totalGeralPeriodo = 0;

    for (const raiz of categoriasRaiz) {
      totalPorRaiz.set(raiz.id, { total: 0, qtd: 0 });
      totalAbertoPorRaiz.set(raiz.id, 0);
    }

    // Buscar exclusões ativas de despesas para desconsiderar da análise de categorias
    const exclusoesAtivas = await prisma.exclusaoMovimentoMedia.findMany({
      where: { usuarioId, ativo: true },
      select: { movimentoId: true },
    });
    const idsExcluidosSet = new Set<string>(exclusoesAtivas.map((e) => e.movimentoId));

    for (const mov of despesasFechadas) {
      if (idsExcluidosSet.has(mov.id)) {
        continue;
      }
      const val = Number(mov.valor);
      totalGeralPeriodo += val;

      const fatias = mov.rateios && mov.rateios.length > 0
        ? mov.rateios.map((r) => ({ categoriaId: r.categoriaId, valor: Number(r.valor) }))
        : mov.categoriaId
        ? [{ categoriaId: mov.categoriaId, valor: val }]
        : [];

      for (const fatia of fatias) {
        // Subcategoria direta
        const subReg = totalPorSub.get(fatia.categoriaId) || { total: 0, qtd: 0 };
        subReg.total += fatia.valor;
        subReg.qtd += 1;
        totalPorSub.set(fatia.categoriaId, subReg);

        // Categoria raiz
        const cat = catMap.get(fatia.categoriaId);
        const raizId = cat ? (cat.categoriaPaiId ? cat.categoriaPaiId : cat.id) : null;
        if (raizId && totalPorRaiz.has(raizId)) {
          const raizReg = totalPorRaiz.get(raizId)!;
          raizReg.total += fatia.valor;
          raizReg.qtd += 1;
        }
      }
    }

    // Acumular mês aberto
    for (const mov of despesasMesAberto) {
      const val = Number(mov.valor);
      const fatias = mov.rateios && mov.rateios.length > 0
        ? mov.rateios.map((r) => ({ categoriaId: r.categoriaId, valor: Number(r.valor) }))
        : mov.categoriaId
        ? [{ categoriaId: mov.categoriaId, valor: val }]
        : [];

      for (const fatia of fatias) {
        const cat = catMap.get(fatia.categoriaId);
        const raizId = cat ? (cat.categoriaPaiId ? cat.categoriaPaiId : cat.id) : null;
        if (raizId && totalAbertoPorRaiz.has(raizId)) {
          totalAbertoPorRaiz.set(raizId, totalAbertoPorRaiz.get(raizId)! + fatia.valor);
        }
      }
    }

    const mediaMensalTotal = Number((totalGeralPeriodo / nMeses).toFixed(2));

    // Montar estrutura hierárquica
    const categoriasItem: HistoricoCategoriaItem[] = categoriasRaiz.map((raiz) => {
      const raizDados = totalPorRaiz.get(raiz.id) || { total: 0, qtd: 0 };
      const totCat = Number(raizDados.total.toFixed(2));
      const medCat = Number((totCat / nMeses).toFixed(2));
      const pctPart =
        totalGeralPeriodo > 0
          ? Number(((totCat / totalGeralPeriodo) * 100).toFixed(2))
          : 0;
      const ticketMedioCat =
        raizDados.qtd > 0 ? Number((totCat / raizDados.qtd).toFixed(2)) : 0;

      const mesAbertoValor = Number((totalAbertoPorRaiz.get(raiz.id) || 0).toFixed(2));
      const mesAbertoDiff = Number((mesAbertoValor - medCat).toFixed(2));

      // Subcategorias pertencentes à raiz
      const subs = subcategoriasPorRaiz.get(raiz.id) || [];
      const subItems: HistoricoSubcategoriaItem[] = subs.map((s) => {
        const sDados = totalPorSub.get(s.id) || { total: 0, qtd: 0 };
        const totSub = Number(sDados.total.toFixed(2));
        const medSub = Number((totSub / nMeses).toFixed(2));
        const pctNaCat =
          totCat > 0 ? Number(((totSub / totCat) * 100).toFixed(2)) : 0;
        const ticketMedioSub =
          sDados.qtd > 0 ? Number((totSub / sDados.qtd).toFixed(2)) : 0;

        return {
          subcategoria_id: s.id,
          nome: s.nome,
          total_periodo: totSub,
          media_mensal: medSub,
          percentual_na_categoria: pctNaCat,
          quantidade_lancamentos: sDados.qtd,
          ticket_medio_lancamento: ticketMedioSub,
        };
      });

      // Ordenar subcategorias por total descrescente
      subItems.sort((a, b) => b.total_periodo - a.total_periodo);

      return {
        categoria_id: raiz.id,
        nome: raiz.nome,
        ordem: raiz.ordem ?? 0,
        total_periodo: totCat,
        media_mensal: medCat,
        percentual_participacao: pctPart,
        quantidade_lancamentos: raizDados.qtd,
        ticket_medio_lancamento: ticketMedioCat,
        subcategorias: subItems,
        mes_aberto_valor: mesAbertoValor,
        mes_aberto_diff_media: mesAbertoDiff,
      };
    });

    // Ordenar categorias por valor total decrescente (ou maior representatividade)
    categoriasItem.sort((a, b) => b.total_periodo - a.total_periodo);

    return {
      janela: {
        inicio: mesesFechados[0] || competenciaAberta,
        fim: mesesFechados[mesesFechados.length - 1] || competenciaAberta,
        meses_fechados: mesesFechados,
      },
      total_periodo: Number(totalGeralPeriodo.toFixed(2)),
      media_mensal: mediaMensalTotal,
      categorias: categoriasItem,
    };
  }
}

export const historicoConsumoService = new HistoricoConsumoService();
