import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../../infrastructure/database/prisma.js';
import { configuracaoService } from '../usuario/configuracao.service.js';
import { calcularUltimosMesesFechados } from '../fase1/baseline.service.js';

export interface ConsolidacaoMediaResultado {
  usuarioId: string;
  competenciaReferencia: string;
  mesesJanela: number;
  totalPeriodoBruto: number;
  totalExcluido: number;
  totalPeriodoEfetivo: number;
  mediaMensalEfetiva: number;
  qtdLancamentosTotais: number;
  qtdLancamentosExcluidos: number;
  categoriasConsolidadas: number;
  novasExclusoesAutomaticas: number;
}

export class MotorExclusaoMediaService {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient = defaultPrisma) {
    this.prisma = prismaClient;
  }

  private normalizarTexto(texto: string): string {
    return texto
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  /**
   * Avalia os lançamentos da janela temporal e executa o motor de regras
   * para identificar e persistir exclusões automáticas (se ainda não registradas).
   */
  public async avaliarEAplicarRegras(
    usuarioId: string,
    mesesJanela?: number,
    competenciaRef?: string
  ): Promise<number> {
    const nMeses =
      mesesJanela && mesesJanela >= 3 && mesesJanela <= 12
        ? mesesJanela
        : await configuracaoService.obterMesesJanelaUsuario(usuarioId);

    const mesesAnalisados = calcularUltimosMesesFechados(competenciaRef, nMeses);

    // 1. Carregar regras ativas do usuário
    const regrasAtivas = await this.prisma.regraExclusaoMedia.findMany({
      where: { usuarioId, ativo: true },
    });

    // 2. Carregar exclusões existentes (para não sobrescrever exclusões manuais ou já ativas)
    const exclusoesExistentes = await this.prisma.exclusaoMovimentoMedia.findMany({
      where: { usuarioId },
    });
    const mapaExclusoes = new Map<string, typeof exclusoesExistentes[0]>();
    for (const exc of exclusoesExistentes) {
      mapaExclusoes.set(exc.movimentoId, exc);
    }

    // 3. Buscar categorias e mapear subcategorias para categoria raiz
    const todasCategorias = await this.prisma.categoria.findMany({
      where: {
        OR: [{ usuarioId: null }, { usuarioId }],
      },
      select: { id: true, nome: true, categoriaPaiId: true },
    });
    const subParaRaizMap = new Map<string, { id: string; nome: string }>();
    const categoriaInfoMap = new Map<string, { id: string; nome: string }>();

    for (const cat of todasCategorias) {
      categoriaInfoMap.set(cat.id, { id: cat.id, nome: cat.nome });
    }

    for (const cat of todasCategorias) {
      if (!cat.categoriaPaiId) {
        subParaRaizMap.set(cat.id, { id: cat.id, nome: cat.nome });
      } else {
        const raiz = categoriaInfoMap.get(cat.categoriaPaiId);
        subParaRaizMap.set(cat.id, raiz || { id: cat.id, nome: cat.nome });
      }
    }

    // 4. Buscar movimentos de despesa conciliados na janela
    const movimentos = await this.prisma.movimento.findMany({
      where: {
        usuarioId,
        competencia: { in: mesesAnalisados },
        natureza: 'DESPESA',
        status: 'CONCILIADO',
      },
      include: {
        categoria: {
          select: { id: true, nome: true, categoriaPaiId: true },
        },
      },
      orderBy: { dataMovimento: 'asc' },
    });

    let novasExclusoes = 0;

    // Detectar frequência de termos / estabelecimentos na janela
    // Para identificar compras esporádicas / únicas
    const contagemOcorrenciasPorDescricao = new Map<string, number>();
    for (const m of movimentos) {
      const descNorm = this.normalizarTexto(m.descricao);
      contagemOcorrenciasPorDescricao.set(
        descNorm,
        (contagemOcorrenciasPorDescricao.get(descNorm) || 0) + 1
      );
    }

    // Calcular média e desvio básico de valor por categoria para identificar outliers
    const valoresPorCategoriaRaiz = new Map<string, number[]>();
    for (const m of movimentos) {
      if (m.categoriaId) {
        const raiz = subParaRaizMap.get(m.categoriaId);
        const raizId = raiz ? raiz.id : m.categoriaId;
        const vals = valoresPorCategoriaRaiz.get(raizId) || [];
        vals.push(Number(m.valor));
        valoresPorCategoriaRaiz.set(raizId, vals);
      }
    }

    const estatisticasCategoria = new Map<string, { media: number; desvio: number }>();
    for (const [catId, vals] of valoresPorCategoriaRaiz.entries()) {
      if (vals.length > 0) {
        const med = vals.reduce((a, b) => a + b, 0) / vals.length;
        const variancia =
          vals.reduce((a, b) => a + Math.pow(b - med, 2), 0) / vals.length;
        const desvio = Math.sqrt(variancia);
        estatisticasCategoria.set(catId, { media: med, desvio });
      }
    }

    for (const mov of movimentos) {
      const jaExiste = mapaExclusoes.get(mov.id);
      // Se já existir exclusão (seja manual ou inativada pelo usuário soberanamente), não sobrescrever
      if (jaExiste) {
        continue;
      }

      let motivoExclusao: string | null = null;
      const descNorm = this.normalizarTexto(mov.descricao);
      const valorNum = Number(mov.valor);

      const raiz = mov.categoriaId ? subParaRaizMap.get(mov.categoriaId) : null;
      const nomeCategoriaRaizNorm = raiz ? this.normalizarTexto(raiz.nome) : '';
      const nomeCategoriaDiretaNorm = mov.categoria?.nome
        ? this.normalizarTexto(mov.categoria.nome)
        : '';

      // Regra 1: Regras explícitas cadastradas pelo usuário
      for (const regra of regrasAtivas) {
        let matchCategoria = true;
        let matchDescricao = true;
        let matchValor = true;
        let matchApenasUmaVez = true;

        if (regra.categoriaId) {
          matchCategoria =
            mov.categoriaId === regra.categoriaId ||
            (Boolean(raiz) && raiz?.id === regra.categoriaId);
        }

        if (regra.descricaoPadrao) {
          const padraoNorm = this.normalizarTexto(regra.descricaoPadrao);
          matchDescricao = descNorm.includes(padraoNorm);
        }

        if (regra.valorMinimo !== null && regra.valorMinimo !== undefined) {
          matchValor = valorNum >= Number(regra.valorMinimo);
        }

        if (regra.apenasUmaVez) {
          const qtd = contagemOcorrenciasPorDescricao.get(descNorm) || 1;
          matchApenasUmaVez = qtd === 1;
        }

        if (matchCategoria && matchDescricao && matchValor && matchApenasUmaVez) {
          motivoExclusao =
            regra.motivo ||
            `Regra de exclusão: ${regra.descricaoPadrao || 'por categoria/valor'}`;
          break;
        }
      }

      // Regra 2: Heurística Canônica Padrão: Viagens isoladas e gastos atípicos de compra única
      if (!motivoExclusao) {
        const isCategoriaViagem =
          nomeCategoriaRaizNorm.includes('viagem') ||
          nomeCategoriaDiretaNorm.includes('viagem');

        const isTermoViagem =
          descNorm.includes('passagem') ||
          descNorm.includes('hospedagem') ||
          descNorm.includes('hotel') ||
          descNorm.includes('viagem') ||
          descNorm.includes('airbnb') ||
          descNorm.includes('decolar') ||
          descNorm.includes('latam') ||
          descNorm.includes('gol linhas') ||
          descNorm.includes('azul linhas');

        const qtdOcorrencias = contagemOcorrenciasPorDescricao.get(descNorm) || 1;

        if (isCategoriaViagem && qtdOcorrencias === 1) {
          motivoExclusao = 'Gasto pontual de viagem com ocorrência única no período';
        } else if (isTermoViagem && qtdOcorrencias === 1 && valorNum >= 150) {
          motivoExclusao = 'Gasto esporádico isolado de viagem/passagem identificado pelo motor';
        } else if (raiz && qtdOcorrencias === 1) {
          // Outlier estatístico severo em compra única (ex: compra isolada > 3x média da categoria e > R$ 500)
          const stats = estatisticasCategoria.get(raiz.id);
          if (stats && stats.media > 0 && valorNum > stats.media * 3 && valorNum >= 500) {
            motivoExclusao = `Gasto atípico de ocorrência única (${valorNum.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} muito acima da média de ${raiz.nome})`;
          }
        }
      }

      if (motivoExclusao) {
        await this.prisma.exclusaoMovimentoMedia.create({
          data: {
            usuarioId,
            movimentoId: mov.id,
            motivo: motivoExclusao,
            origem: 'AUTOMATICA',
            ativo: true,
          },
        });
        novasExclusoes++;
      }
    }

    return novasExclusoes;
  }

  /**
   * Recalcula e persiste a tabela consolidada de médias para o usuário.
   */
  public async consolidarMedias(
    usuarioId: string,
    mesesJanelaParam?: number,
    competenciaRefParam?: string
  ): Promise<ConsolidacaoMediaResultado> {
    const nMeses =
      mesesJanelaParam && mesesJanelaParam >= 3 && mesesJanelaParam <= 12
        ? mesesJanelaParam
        : await configuracaoService.obterMesesJanelaUsuario(usuarioId);

    let compInicio = competenciaRefParam;
    if (!compInicio) {
      const agora = new Date();
      compInicio = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
    }

    // 1. Executa avaliação de regras
    const novasExclusoesAutomaticas = await this.avaliarEAplicarRegras(
      usuarioId,
      nMeses,
      compInicio
    );

    const mesesAnalisados = calcularUltimosMesesFechados(compInicio, nMeses);

    // 2. Buscar categorias raízes da POF
    const categoriasRaiz = await this.prisma.categoria.findMany({
      where: {
        categoriaPaiId: null,
        OR: [{ usuarioId: null }, { usuarioId }],
      },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    });

    const todasCategorias = await this.prisma.categoria.findMany({
      where: {
        OR: [{ usuarioId: null }, { usuarioId }],
      },
      select: { id: true, categoriaPaiId: true },
    });

    const subParaRaizMap = new Map<string, string>();
    for (const cat of todasCategorias) {
      if (!cat.categoriaPaiId) {
        subParaRaizMap.set(cat.id, cat.id);
      } else {
        subParaRaizMap.set(cat.id, cat.categoriaPaiId);
      }
    }

    // 3. Buscar exclusões ativas do usuário
    const exclusoesAtivas = await this.prisma.exclusaoMovimentoMedia.findMany({
      where: { usuarioId, ativo: true },
      select: { movimentoId: true },
    });
    const idsExcluidosSet = new Set<string>(exclusoesAtivas.map((e) => e.movimentoId));

    // 4. Buscar movimentos de despesa do período
    const movimentosDespesa = await this.prisma.movimento.findMany({
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

    let totalPeriodoBruto = 0;
    let totalExcluido = 0;
    let qtdLancamentosTotais = movimentosDespesa.length;
    let qtdLancamentosExcluidos = 0;

    // Totais por categoria raiz
    const brutoPorCategoriaRaiz = new Map<string, number>();
    const excluidoPorCategoriaRaiz = new Map<string, number>();
    const qtdTotaisPorCat = new Map<string, number>();
    const qtdExcluidasPorCat = new Map<string, number>();

    for (const raiz of categoriasRaiz) {
      brutoPorCategoriaRaiz.set(raiz.id, 0);
      excluidoPorCategoriaRaiz.set(raiz.id, 0);
      qtdTotaisPorCat.set(raiz.id, 0);
      qtdExcluidasPorCat.set(raiz.id, 0);
    }

    for (const mov of movimentosDespesa) {
      const valorTotal = Number(mov.valor);
      totalPeriodoBruto += valorTotal;

      const estaExcluido = idsExcluidosSet.has(mov.id);
      if (estaExcluido) {
        totalExcluido += valorTotal;
        qtdLancamentosExcluidos++;
      }

      // Distribuição por categoria raiz
      if (mov.rateios && mov.rateios.length > 0) {
        for (const rat of mov.rateios) {
          const valSplit = Number(rat.valor);
          const raizId = subParaRaizMap.get(rat.categoriaId);
          if (raizId && brutoPorCategoriaRaiz.has(raizId)) {
            brutoPorCategoriaRaiz.set(
              raizId,
              (brutoPorCategoriaRaiz.get(raizId) || 0) + valSplit
            );
            qtdTotaisPorCat.set(raizId, (qtdTotaisPorCat.get(raizId) || 0) + 1);

            if (estaExcluido) {
              excluidoPorCategoriaRaiz.set(
                raizId,
                (excluidoPorCategoriaRaiz.get(raizId) || 0) + valSplit
              );
              qtdExcluidasPorCat.set(raizId, (qtdExcluidasPorCat.get(raizId) || 0) + 1);
            }
          }
        }
      } else if (mov.categoriaId) {
        const raizId = subParaRaizMap.get(mov.categoriaId);
        if (raizId && brutoPorCategoriaRaiz.has(raizId)) {
          brutoPorCategoriaRaiz.set(
            raizId,
            (brutoPorCategoriaRaiz.get(raizId) || 0) + valorTotal
          );
          qtdTotaisPorCat.set(raizId, (qtdTotaisPorCat.get(raizId) || 0) + 1);

          if (estaExcluido) {
            excluidoPorCategoriaRaiz.set(
              raizId,
              (excluidoPorCategoriaRaiz.get(raizId) || 0) + valorTotal
            );
            qtdExcluidasPorCat.set(raizId, (qtdExcluidasPorCat.get(raizId) || 0) + 1);
          }
        }
      }
    }

    const totalPeriodoEfetivo = Number((totalPeriodoBruto - totalExcluido).toFixed(2));
    const mediaMensalEfetiva = Number((totalPeriodoEfetivo / nMeses).toFixed(2));

    // 5. Upsert da média consolidada GLOBAL (categoriaId: null)
    const existenteGlobal = await this.prisma.mediaMensalConsolidada.findFirst({
      where: {
        usuarioId,
        categoriaId: null,
        competenciaReferencia: compInicio,
        mesesJanela: nMeses,
      },
    });

    if (existenteGlobal) {
      await this.prisma.mediaMensalConsolidada.update({
        where: { id: existenteGlobal.id },
        data: {
          totalPeriodoBruto: Number(totalPeriodoBruto.toFixed(2)),
          totalExcluido: Number(totalExcluido.toFixed(2)),
          totalPeriodoEfetivo,
          mediaMensalEfetiva,
          qtdLancamentosTotais,
          qtdLancamentosExcluidos,
          atualizadoEm: new Date(),
        },
      });
    } else {
      await this.prisma.mediaMensalConsolidada.create({
        data: {
          usuarioId,
          categoriaId: null,
          competenciaReferencia: compInicio,
          mesesJanela: nMeses,
          totalPeriodoBruto: Number(totalPeriodoBruto.toFixed(2)),
          totalExcluido: Number(totalExcluido.toFixed(2)),
          totalPeriodoEfetivo,
          mediaMensalEfetiva,
          qtdLancamentosTotais,
          qtdLancamentosExcluidos,
        },
      });
    }

    // 6. Upsert da média consolidada por categoria raiz
    for (const raiz of categoriasRaiz) {
      const bCat = Number((brutoPorCategoriaRaiz.get(raiz.id) || 0).toFixed(2));
      const eCat = Number((excluidoPorCategoriaRaiz.get(raiz.id) || 0).toFixed(2));
      const efCat = Number((bCat - eCat).toFixed(2));
      const medCat = Number((efCat / nMeses).toFixed(2));

      await this.prisma.mediaMensalConsolidada.upsert({
        where: {
          usuarioId_categoriaId_competenciaReferencia_mesesJanela: {
            usuarioId,
            categoriaId: raiz.id,
            competenciaReferencia: compInicio,
            mesesJanela: nMeses,
          },
        },
        create: {
          usuarioId,
          categoriaId: raiz.id,
          competenciaReferencia: compInicio,
          mesesJanela: nMeses,
          totalPeriodoBruto: bCat,
          totalExcluido: eCat,
          totalPeriodoEfetivo: efCat,
          mediaMensalEfetiva: medCat,
          qtdLancamentosTotais: qtdTotaisPorCat.get(raiz.id) || 0,
          qtdLancamentosExcluidos: qtdExcluidasPorCat.get(raiz.id) || 0,
        },
        update: {
          totalPeriodoBruto: bCat,
          totalExcluido: eCat,
          totalPeriodoEfetivo: efCat,
          mediaMensalEfetiva: medCat,
          qtdLancamentosTotais: qtdTotaisPorCat.get(raiz.id) || 0,
          qtdLancamentosExcluidos: qtdExcluidasPorCat.get(raiz.id) || 0,
          atualizadoEm: new Date(),
        },
      });
    }

    return {
      usuarioId,
      competenciaReferencia: compInicio,
      mesesJanela: nMeses,
      totalPeriodoBruto: Number(totalPeriodoBruto.toFixed(2)),
      totalExcluido: Number(totalExcluido.toFixed(2)),
      totalPeriodoEfetivo,
      mediaMensalEfetiva,
      qtdLancamentosTotais,
      qtdLancamentosExcluidos,
      categoriasConsolidadas: categoriasRaiz.length,
      novasExclusoesAutomaticas,
    };
  }
}

export const motorExclusaoMediaService = new MotorExclusaoMediaService();
