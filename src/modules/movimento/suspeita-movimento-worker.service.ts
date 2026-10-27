import { prisma } from '../../infrastructure/database/prisma.js';
import { extrairRaizComerciante } from './movimento.util.js';
import { REGEX_APORTES_INVESTIMENTOS } from './movimento-recalculo.service.js';
import { classificadorCombinatorioService } from './classificador-combinatorio.service.js';
import { env } from '../../config/env.js';
import {
  saoMesmaInstituicaoOuEquivalente,
  saoDuplicatasSemanticas,
  saoDistintosPorIdentificador,
  calcularSimilaridadeTexto,
} from './validacao-deduplicacao.service.js';

export interface SuspeitaCatalogoItem {
  id: string;
  tipo: 'SUSPEITA_DUPLICATA' | 'SUSPEITA_APORTE' | 'SUSPEITA_CATEGORIZACAO';
  confianca: number;
  motivo: string;
  movimentoId: string;
  movimentoSecundarioId?: string | null;
  sugestaoNatureza?: string | null;
  categoriaSugerida?: string | null;
}

export class SuspeitaMovimentoWorkerService {
  /**
   * Cataloga e persiste todas as suspeitas detectadas para o usuário diretamente na tabela
   * `suspeitas_movimento`. A catalogação roda em background no worker (durante login,
   * ao final de lotes de importação ou reprocessamento explícito).
   */
  public static async catalogarSuspeitasParaUsuario(
    usuarioId: string,
    opcoes?: { similaridadeMinima?: number }
  ): Promise<{
    totalDuplicatas: number;
    totalAportes: number;
    totalCategorizacao: number;
    totalGravadas: number;
  }> {
    const similaridadeMinima = opcoes?.similaridadeMinima ?? env.DUPLICATA_SIMILARIDADE_MINIMA;

    // 1. Busca todos os movimentos do usuário
    const todosMovimentos = await prisma.movimento.findMany({
      where: { usuarioId },
      include: {
        conta: {
          select: { id: true, nome: true, tipo: true, numeroConta: true, digitosCartao: true },
        },
        categoria: {
          select: { id: true, nome: true, categoriaPaiId: true },
        },
      },
      orderBy: { dataMovimento: 'desc' },
    });

    const suspeitasParaPersistir: Array<{
      usuarioId: string;
      tipo: 'SUSPEITA_DUPLICATA' | 'SUSPEITA_APORTE' | 'SUSPEITA_CATEGORIZACAO';
      status: 'PENDENTE';
      confianca: number;
      motivo: string;
      movimentoId: string;
      movimentoSecundarioId?: string | null;
      sugestaoNatureza?: string | null;
      categoriaSugerida?: string | null;
    }> = [];

    // Agrupamento para detecção O(N) de duplicatas em potencial
    const gruposDuplicatas = new Map<string, typeof todosMovimentos>();
    const processadosDuplicatas = new Set<string>();

    // Pré-carrega todos os aportes patrimoniais do usuário para validação cruzada eficiente
    const aportesUsuario = todosMovimentos.filter(
      (m) => m.natureza === 'APORTE_PATRIMONIAL'
    );

    for (const mov of todosMovimentos) {
      const dataStr = mov.dataMovimento.toISOString().slice(0, 10);
      const chave = `${dataStr}_${Number(mov.valor).toFixed(2)}_${mov.natureza}`;
      let lista = gruposDuplicatas.get(chave);
      if (!lista) {
        lista = [];
        gruposDuplicatas.set(chave, lista);
      }
      lista.push(mov);

      // Suspeita de Aporte / Investimento: despesa com termos financeiros sem validação soberana
      const jaValidadoSoberano = mov.validadoDedupe === 'S' && mov.categoriaFixadaPeloUsuario;
      if (!jaValidadoSoberano && mov.natureza === 'DESPESA' && REGEX_APORTES_INVESTIMENTOS.test(mov.descricao)) {
        suspeitasParaPersistir.push({
          usuarioId,
          tipo: 'SUSPEITA_APORTE',
          status: 'PENDENTE',
          confianca: 0.90,
          motivo: 'A descrição contém termos característicos de aplicação financeira ou investimento (CDB, Poupança, Ações ou Tesouro).',
          movimentoId: mov.id,
          sugestaoNatureza: 'APORTE_PATRIMONIAL',
        });
      }

      // Suspeita de Categorização em "Outros" ou sem categoria com valor relevante (>= R$ 50)
      const nomeCategoria = mov.categoria?.nome?.toLowerCase() || '';
      const isSemCategoriaOuOutros = !mov.categoriaId || nomeCategoria === 'outros' || nomeCategoria.includes('outras despesas');
      if (
        !jaValidadoSoberano &&
        mov.natureza === 'DESPESA' &&
        isSemCategoriaOuOutros &&
        Number(mov.valor) >= 50
      ) {
        // Validação com Aportes Patrimoniais:
        // Se este débito/despesa possui correspondente já registrado em Aportes (mesmo valor e data dentro da janela de conciliação de até 2 dias),
        // ele já está mapeado no patrimônio (ex: aplicação financeira, Pix para aporte em outra instituição)
        const valorMov = Number(mov.valor);
        const dataMovTime = new Date(mov.dataMovimento).getTime();
        const doisDiasMs = 2 * 24 * 60 * 60 * 1000;

        const aporteCorrespondente = aportesUsuario.find((ap) => {
          if (Math.abs(Number(ap.valor) - valorMov) >= 0.01) return false;
          const dataApTime = new Date(ap.dataMovimento).getTime();
          const diffDias = Math.abs(dataMovTime - dataApTime);
          return diffDias <= doisDiasMs;
        });

        if (aporteCorrespondente) {
          // Lançamento já mapeado em Aportes! Não levanta falso positivo de "Alta Materialidade em Outros".
          continue;
        }

        // Verifica se há regra prévia cadastrada pelo próprio usuário para esta loja/vendedor
        const raiz = extrairRaizComerciante(mov.descricao);
        let regraVendedorEncontrada = null;
        if (raiz && raiz.length >= 3) {
          regraVendedorEncontrada = await prisma.regraVendedorCategoria.findFirst({
            where: {
              usuarioId,
              termoVendedor: { equals: raiz, mode: 'insensitive' },
            },
            include: {
              categoria: { select: { id: true, nome: true } },
            },
          });
        }

        if (regraVendedorEncontrada) {
          suspeitasParaPersistir.push({
            usuarioId,
            tipo: 'SUSPEITA_CATEGORIZACAO',
            status: 'PENDENTE',
            confianca: 0.98,
            motivo: `Lançamento de "${raiz}" correspondente à regra cadastrada no seu catálogo de lojas para a categoria "${regraVendedorEncontrada.categoria.nome}".`,
            movimentoId: mov.id,
            categoriaSugerida: regraVendedorEncontrada.categoria.nome,
          });
        } else {
          const inferencia = classificadorCombinatorioService.inferirCategoria(
            mov.descricao,
            mov.dataMovimento,
            Number(mov.valor)
          );

          suspeitasParaPersistir.push({
            usuarioId,
            tipo: 'SUSPEITA_CATEGORIZACAO',
            status: 'PENDENTE',
            confianca: inferencia?.confianca ?? 0.65,
            motivo: inferencia
              ? `Lançamento em categoria genérica com alta probabilidade combinatória: ${inferencia.explicacao}`
              : 'Lançamento de alta materialidade alocado em "Outros" ou sem categoria definida.',
            movimentoId: mov.id,
            categoriaSugerida: inferencia?.categoriaSugerida,
          });
        }
      }
    }

    // Compara apenas os elementos dentro dos grupos que possuem mais de 1 lançamento
    for (const [, grupo] of gruposDuplicatas) {
      if (grupo.length <= 1) continue;

      for (let i = 0; i < grupo.length; i++) {
        const mA = grupo[i];
        if (processadosDuplicatas.has(mA.id)) continue;

        for (let j = i + 1; j < grupo.length; j++) {
          const mB = grupo[j];
          if (processadosDuplicatas.has(mB.id)) continue;

          const dataA = mA.dataMovimento.toISOString().slice(0, 10);
          const dataB = mB.dataMovimento.toISOString().slice(0, 10);

          const ambosValidadosPeloUsuario =
            mA.categoriaFixadaPeloUsuario && mA.validadoDedupe === 'S' &&
            mB.categoriaFixadaPeloUsuario && mB.validadoDedupe === 'S';

          if (ambosValidadosPeloUsuario) continue;

          // Transferências entre contas distintas não são duplicatas
          if (mA.natureza === 'TRANSFERENCIA_PROPRIA' && mA.contaId !== mB.contaId) {
            continue;
          }

          const raizDescA = extrairRaizComerciante(mA.descricao);
          const raizDescB = extrairRaizComerciante(mB.descricao);
          const simDescricaoBruta = calcularSimilaridadeTexto(mA.descricao, mB.descricao);
          const simRaizes = calcularSimilaridadeTexto(raizDescA, raizDescB);
          const similaridadeDescricao = Math.min(simDescricaoBruta, simRaizes);

          if (saoDistintosPorIdentificador(mA.descricao, mB.descricao)) {
            continue;
          }

          const mesmaConta = mA.contaId === mB.contaId;
          const mesmaInstituicao = mesmaConta || saoMesmaInstituicaoOuEquivalente(
            mA.conta,
            mA.origemDocumento,
            mB.conta,
            mB.origemDocumento
          );
          const ehDuplicataSemantica = saoDuplicatasSemanticas(mA, mB);
          const atingeSimilaridadeMinima = similaridadeDescricao >= similaridadeMinima;

          const ehSuspeitaDuplicata = mesmaInstituicao && (atingeSimilaridadeMinima || ehDuplicataSemantica);

          if (ehSuspeitaDuplicata) {
            processadosDuplicatas.add(mA.id);
            processadosDuplicatas.add(mB.id);

            const confiancaCalculada = ehDuplicataSemantica
              ? Math.max(0.90, Math.round(similaridadeDescricao * 100) / 100)
              : Math.max(similaridadeMinima, Math.round(similaridadeDescricao * 100) / 100);

            suspeitasParaPersistir.push({
              usuarioId,
              tipo: 'SUSPEITA_DUPLICATA',
              status: 'PENDENTE',
              confianca: confiancaCalculada,
              motivo: `Lançamentos com mesmo valor (R$ ${Number(mA.valor).toFixed(2)}) e mesma data (${dataA}) com nomes semelhantes (${Math.round(similaridadeDescricao * 100)}% de similaridade).`,
              movimentoId: mA.id,
              movimentoSecundarioId: mB.id,
            });
            break;
          }
        }
      }
    }

    // Atualização atômica na tabela suspeitas_movimento:
    // Remove as suspeitas PENDENTES anteriores e grava a nova catalogação fresca
    await prisma.$transaction(async (tx) => {
      await tx.suspeitaMovimento.deleteMany({
        where: {
          usuarioId,
          status: 'PENDENTE',
        },
      });

      if (suspeitasParaPersistir.length > 0) {
        await tx.suspeitaMovimento.createMany({
          data: suspeitasParaPersistir.map((s) => ({
            usuarioId: s.usuarioId,
            tipo: s.tipo,
            status: s.status,
            confianca: s.confianca,
            motivo: s.motivo,
            movimentoId: s.movimentoId,
            movimentoSecundarioId: s.movimentoSecundarioId,
            sugestaoNatureza: s.sugestaoNatureza,
            categoriaSugerida: s.categoriaSugerida,
          })),
        });
      }
    });

    const totalDuplicatas = suspeitasParaPersistir.filter((s) => s.tipo === 'SUSPEITA_DUPLICATA').length;
    const totalAportes = suspeitasParaPersistir.filter((s) => s.tipo === 'SUSPEITA_APORTE').length;
    const totalCategorizacao = suspeitasParaPersistir.filter((s) => s.tipo === 'SUSPEITA_CATEGORIZACAO').length;

    return {
      totalDuplicatas,
      totalAportes,
      totalCategorizacao,
      totalGravadas: suspeitasParaPersistir.length,
    };
  }
}
