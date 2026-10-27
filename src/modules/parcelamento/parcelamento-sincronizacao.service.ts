import { prisma } from '../../infrastructure/database/prisma.js';
import { extrairInfoParcelamento } from '../movimento/movimento.util.js';
import { addMesesCompetencia } from './parcelamento.util.js';

export interface SincronizacaoParcelamentoResultado {
  usuarioId: string;
  totalAvaliados: number;
  totalDeduplicados: number;
  totalQuitados: number;
  totalParcelasAvancadas: number;
}

/**
 * Converte competência YYYY-MM para número absoluto de meses.
 */
function compToMonths(comp: string): number {
  const [ano, mes] = comp.split('-').map(Number);
  return ano * 12 + mes;
}

/**
 * Obtém a competência atual no formato YYYY-MM.
 */
export function obterCompetenciaAtual(): string {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  return `${ano}-${mes}`;
}

export class ParcelamentoSincronizacaoService {
  /**
   * Executa a sincronização, deduplicação e quitação temporal dos parcelamentos
   * para o usuário autenticado com isolamento estrito por usuarioId.
   */
  public static async sincronizarParaUsuario(
    usuarioId: string,
    competenciaReferencia?: string
  ): Promise<SincronizacaoParcelamentoResultado> {
    const compAtual = competenciaReferencia || obterCompetenciaAtual();
    const targetMonths = compToMonths(compAtual);

    const resultado: SincronizacaoParcelamentoResultado = {
      usuarioId,
      totalAvaliados: 0,
      totalDeduplicados: 0,
      totalQuitados: 0,
      totalParcelasAvancadas: 0,
    };

    // 1. Buscar todos os parcelamentos do usuário
    const parcelamentos = await prisma.parcelamento.findMany({
      where: { usuarioId },
      orderBy: [
        { primeiroVencimento: 'asc' },
        { criadoEm: 'asc' },
      ],
    });

    resultado.totalAvaliados = parcelamentos.length;
    if (parcelamentos.length === 0) {
      return resultado;
    }

    // --- PASSO 1: DEDUPLICAÇÃO DE CONTRATOS FRACIONADOS ---
    // Agrupar parcelamentos que pertencem à mesma compra original
    // Critérios: contaId, totalParcelas e prefixoBase extraído da descrição
    type ParcelamentoItem = typeof parcelamentos[0];
    const grupos = new Map<string, ParcelamentoItem[]>();

    for (const p of parcelamentos) {
      const info = extrairInfoParcelamento(p.descricao);
      const prefixoBase = (info?.prefixoBase || p.descricao).trim().toUpperCase();
      const chaveGrupo = `${p.contaId || 'SEM_CONTA'}_${p.totalParcelas}_${prefixoBase}`;

      const grupo = grupos.get(chaveGrupo) || [];
      grupo.push(p);
      grupos.set(chaveGrupo, grupo);
    }

    const idsExcluidos = new Set<string>();

    for (const [_, grupo] of grupos.entries()) {
      if (grupo.length > 1) {
        // Encontra o registro principal: o com o primeiroVencimento mais antigo (ou criadoEm mais antigo)
        grupo.sort((a, b) => {
          const compDiff = compToMonths(a.primeiroVencimento) - compToMonths(b.primeiroVencimento);
          if (compDiff !== 0) return compDiff;
          return a.criadoEm.getTime() - b.criadoEm.getTime();
        });

        const principal = grupo[0];
        const duplicados = grupo.slice(1);

        // Maior parcela observada entre todos os fragmentos
        const maiorParcela = Math.max(...grupo.map((g) => g.parcelaAtual));

        // Descrição limpa baseada no prefixoBase
        const infoPrincipal = extrairInfoParcelamento(principal.descricao);
        const descricaoPadrao = infoPrincipal?.prefixoBase || principal.descricao;

        // Se algum foi CANCELADO e todos forem, respeitar, senão manter ATIVO ou QUITADO
        const algumAtivo = grupo.some((g) => g.status === 'ATIVO');
        const statusBase = algumAtivo ? 'ATIVO' : principal.status;

        await prisma.parcelamento.update({
          where: { id: principal.id },
          data: {
            descricao: descricaoPadrao,
            parcelaAtual: Math.max(principal.parcelaAtual, maiorParcela),
            status: statusBase,
          },
        });

        // Atualiza a referência em memória do principal
        principal.descricao = descricaoPadrao;
        principal.parcelaAtual = Math.max(principal.parcelaAtual, maiorParcela);
        principal.status = statusBase;

        // Remover os fragmentos duplicados do banco
        for (const dup of duplicados) {
          await prisma.parcelamento.delete({
            where: { id: dup.id },
          });
          idsExcluidos.add(dup.id);
          resultado.totalDeduplicados++;
        }
      }
    }

    // Filtra os parcelamentos ativos/remanescentes que não foram excluídos
    const remanescentes = parcelamentos.filter((p) => !idsExcluidos.has(p.id));

    // --- PASSO 1.5: ALINHAMENTO COM A COMPETÊNCIA REAL DOS MOVIMENTOS ---
    // Busca movimentos oficiais do usuário para calibrar primeiroVencimento e ultimoVencimento
    const movimentosParcelados = await prisma.movimento.findMany({
      where: {
        usuarioId,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
      },
      select: {
        contaId: true,
        competencia: true,
        descricao: true,
      },
    });

    for (const p of remanescentes) {
      if (p.status === 'CANCELADO') continue;

      const infoP = extrairInfoParcelamento(p.descricao);
      const baseP = (infoP?.prefixoBase || p.descricao).trim().toUpperCase();

      // Encontra movimentos correspondentes desta conta com mesmo totalParcelas e mesma base
      const movsIrmaos = movimentosParcelados.filter((m) => {
        if (m.contaId !== p.contaId) return false;
        const infoM = extrairInfoParcelamento(m.descricao);
        if (!infoM || infoM.totalParcelas !== p.totalParcelas) return false;
        const baseM = infoM.prefixoBase.trim().toUpperCase();
        return baseM === baseP;
      });

      if (movsIrmaos.length > 0) {
        // Ordena pela maior parcela observada para ancorar a competência
        movsIrmaos.sort((a, b) => {
          const pA = extrairInfoParcelamento(a.descricao)?.parcelaAtual || 0;
          const pB = extrairInfoParcelamento(b.descricao)?.parcelaAtual || 0;
          return pB - pA;
        });

        const mRef = movsIrmaos[0];
        const infoRef = extrairInfoParcelamento(mRef.descricao);
        if (infoRef) {
          const primEsperado = addMesesCompetencia(mRef.competencia, -(infoRef.parcelaAtual - 1));
          const ultEsperado = addMesesCompetencia(primEsperado, p.totalParcelas - 1);
          const maiorParcelaReal = infoRef.parcelaAtual;

          const p1Months = compToMonths(primEsperado);
          const diffComp = targetMonths - p1Months;
          const parcelaCalculadaRef = diffComp >= 0 ? diffComp + 1 : 1;
          const parcelaRealFinal = Math.min(
            p.totalParcelas,
            Math.max(maiorParcelaReal, parcelaCalculadaRef)
          );
          const statusEsperado =
            targetMonths > compToMonths(ultEsperado) ||
            (parcelaRealFinal >= p.totalParcelas && targetMonths >= compToMonths(ultEsperado))
              ? 'QUITADO'
              : 'ATIVO';

          if (
            p.primeiroVencimento !== primEsperado ||
            p.ultimoVencimento !== ultEsperado ||
            p.parcelaAtual !== parcelaRealFinal ||
            p.status !== statusEsperado
          ) {
            await prisma.parcelamento.update({
              where: { id: p.id },
              data: {
                primeiroVencimento: primEsperado,
                ultimoVencimento: ultEsperado,
                parcelaAtual: parcelaRealFinal,
                status: statusEsperado,
              },
            });
            p.primeiroVencimento = primEsperado;
            p.ultimoVencimento = ultEsperado;
            p.parcelaAtual = parcelaRealFinal;
            p.status = statusEsperado;
          }
        }
      }
    }

    // --- PASSO 2: AVANÇO TEMPORAL E AUTO-QUITAÇÃO ---
    for (const p of remanescentes) {
      // Ignorar cancelados
      if (p.status === 'CANCELADO') {
        continue;
      }

      const primeiroMonths = compToMonths(p.primeiroVencimento);
      const ultimoMonths = compToMonths(p.ultimoVencimento);

      // Quantos meses se passaram desde o primeiro vencimento até a competência atual
      // Ex: primeiroVencimento = 2026-01 (mês 1), compAtual = 2026-02 (mês 2) -> diff = 1 -> parcelaCalculada = 2
      const diffMeses = targetMonths - primeiroMonths;
      const parcelaCalculada = diffMeses >= 0 ? diffMeses + 1 : 1;

      const contratoExpirado = targetMonths > ultimoMonths || parcelaCalculada > p.totalParcelas;

      if (contratoExpirado) {
        if (p.status !== 'QUITADO' || p.parcelaAtual !== p.totalParcelas) {
          await prisma.parcelamento.update({
            where: { id: p.id },
            data: {
              status: 'QUITADO',
              parcelaAtual: p.totalParcelas,
            },
          });
          resultado.totalQuitados++;
        }
      } else {
        // Se ainda está dentro do período de vigência
        const novaParcela = Math.min(
          p.totalParcelas,
          Math.max(p.parcelaAtual, parcelaCalculada)
        );

        if (novaParcela >= p.totalParcelas && targetMonths >= ultimoMonths) {
          await prisma.parcelamento.update({
            where: { id: p.id },
            data: {
              status: 'QUITADO',
              parcelaAtual: p.totalParcelas,
            },
          });
          resultado.totalQuitados++;
        } else if (novaParcela > p.parcelaAtual) {
          await prisma.parcelamento.update({
            where: { id: p.id },
            data: {
              parcelaAtual: novaParcela,
            },
          });
          resultado.totalParcelasAvancadas++;
        }
      }
    }

    // --- PASSO 3: GERAÇÃO DE PARCELAS FUTURAS PREVISTAS (Lançamento antecipado de parcelas) ---
    // Cria movimentos com status PREVISTO para as competências futuras dos contratos ATIVOS
    await ParcelamentoSincronizacaoService.gerarParcelasFuturasPrevistas(usuarioId, compAtual);

    return resultado;
  }

  /**
   * Gera lançamentos futuros com status PREVISTO para contratos de parcelamento ativos,
   * garantindo que os meses subsequentes (ex: novembro) já contenham suas respectivas parcelas.
   */
  public static async gerarParcelasFuturasPrevistas(
    usuarioId: string,
    competenciaBaseReferencia?: string
  ): Promise<number> {
    const compBase = competenciaBaseReferencia || obterCompetenciaAtual();
    const baseMonths = compToMonths(compBase);

    // 1. Buscar todos os parcelamentos ATIVOS do usuário
    const parcelamentosAtivos = await prisma.parcelamento.findMany({
      where: {
        usuarioId,
        status: 'ATIVO',
      },
      include: {
        conta: {
          select: {
            id: true,
            diaVencimento: true,
            tipo: true,
          },
        },
      },
    });

    if (parcelamentosAtivos.length === 0) {
      return 0;
    }

    // 2. Buscar movimentos existentes (CONCILIADOS e PREVISTOS) do usuário
    const movimentosExistentes = await prisma.movimento.findMany({
      where: {
        usuarioId,
        natureza: 'DESPESA',
      },
      select: {
        id: true,
        contaId: true,
        competencia: true,
        descricao: true,
        chaveDedupe: true,
      },
    });

    let totalCriados = 0;

    for (const parc of parcelamentosAtivos) {
      const primeiroMonths = compToMonths(parc.primeiroVencimento);
      const ultimoMonths = compToMonths(parc.ultimoVencimento);

      // Gera parcelas para as competências futuras a partir de compBase + 1 até ultimoVencimento
      for (let m = baseMonths + 1; m <= ultimoMonths; m++) {
        const ano = Math.floor((m - 1) / 12);
        const mes = ((m - 1) % 12) + 1;
        const compFutura = `${ano}-${String(mes).padStart(2, '0')}`;

        // Número da parcela nesta competência futura
        const numeroParcela = m - primeiroMonths + 1;
        if (numeroParcela < 1 || numeroParcela > parc.totalParcelas) {
          continue;
        }

        const infoBase = extrairInfoParcelamento(parc.descricao);
        const prefixoBase = (infoBase?.prefixoBase || parc.descricao).trim();
        const descricaoParcela = `${prefixoBase} - Parcela ${numeroParcela}/${parc.totalParcelas}`;

        // Verifica se já existe um movimento conciliado ou previsto para esta parcela
        const jaExiste = movimentosExistentes.some((mov) => {
          if (mov.contaId !== parc.contaId || mov.competencia !== compFutura) return false;
          const infoM = extrairInfoParcelamento(mov.descricao);
          if (!infoM) return false;
          const baseM = infoM.prefixoBase.trim().toUpperCase();
          const pBase = prefixoBase.trim().toUpperCase();
          return (
            (baseM === pBase || baseM.includes(pBase) || pBase.includes(baseM)) &&
            infoM.parcelaAtual === numeroParcela &&
            infoM.totalParcelas === parc.totalParcelas
          );
        });

        if (jaExiste) {
          continue;
        }

        const diaVenc = parc.conta?.diaVencimento || 10;
        const diaFormatado = String(Math.min(diaVenc, 28)).padStart(2, '0');
        const dataMovimento = new Date(`${compFutura}-${diaFormatado}T00:00:00.000Z`);
        const valorNum = Number(parc.parcelaValor);
        const chaveDedupe = `DEDUPE_PARC_PREVISTO_${parc.contaId}_${compFutura}_${valorNum.toFixed(2)}_${descricaoParcela.toLowerCase()}`;

        const novoMov = await prisma.movimento.create({
          data: {
            usuarioId,
            contaId: parc.contaId || '',
            categoriaId: parc.categoriaId,
            dataMovimento,
            competencia: compFutura,
            descricao: descricaoParcela,
            valor: valorNum,
            natureza: 'DESPESA',
            status: 'PREVISTO',
            chaveDedupe,
            observacao: `Parcela futura projetada (${numeroParcela}/${parc.totalParcelas}) do contrato ${prefixoBase}`,
            origemDocumento: 'PROJECAO_PARCELAMENTO',
          },
        });

        movimentosExistentes.push({
          id: novoMov.id,
          contaId: novoMov.contaId,
          competencia: novoMov.competencia,
          descricao: novoMov.descricao,
          chaveDedupe: novoMov.chaveDedupe,
        });

        totalCriados++;
      }
    }

    return totalCriados;
  }
}
