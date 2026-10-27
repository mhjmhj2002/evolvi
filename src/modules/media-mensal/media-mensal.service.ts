import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../../infrastructure/database/prisma.js';
import { motorExclusaoMediaService } from './motor-exclusao-media.service.js';
import { configuracaoService } from '../usuario/configuracao.service.js';
import { calcularUltimosMesesFechados } from '../fase1/baseline.service.js';

export interface PesquisaLancamentosParams {
  termo?: string;
  competencia?: string;
  categoriaId?: string;
  apenasExcluidos?: boolean;
  limite?: number;
}

export class MediaMensalService {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient = defaultPrisma) {
    this.prisma = prismaClient;
  }

  // --- CRUD DE REGRAS DE EXCLUSÃO ---

  public async listarRegras(usuarioId: string) {
    return await this.prisma.regraExclusaoMedia.findMany({
      where: { usuarioId },
      include: {
        categoria: {
          select: { id: true, nome: true },
        },
      },
      orderBy: { criadoEm: 'desc' },
    });
  }

  public async criarRegra(
    usuarioId: string,
    dados: {
      categoriaId?: string | null;
      descricaoPadrao?: string | null;
      valorMinimo?: number | null;
      apenasUmaVez?: boolean;
      ativo?: boolean;
      motivo?: string | null;
    }
  ) {
    const regra = await this.prisma.regraExclusaoMedia.create({
      data: {
        usuarioId,
        categoriaId: dados.categoriaId ?? null,
        descricaoPadrao: dados.descricaoPadrao ?? null,
        valorMinimo: dados.valorMinimo ? Number(dados.valorMinimo) : null,
        apenasUmaVez: dados.apenasUmaVez ?? false,
        ativo: dados.ativo ?? true,
        motivo: dados.motivo ?? null,
      },
      include: {
        categoria: {
          select: { id: true, nome: true },
        },
      },
    });

    // Reexecuta consolidação com a nova regra
    await motorExclusaoMediaService.consolidarMedias(usuarioId);

    return regra;
  }

  public async atualizarRegra(
    usuarioId: string,
    id: string,
    dados: {
      categoriaId?: string | null;
      descricaoPadrao?: string | null;
      valorMinimo?: number | null;
      apenasUmaVez?: boolean;
      ativo?: boolean;
      motivo?: string | null;
    }
  ) {
    const regraExistente = await this.prisma.regraExclusaoMedia.findFirst({
      where: { id, usuarioId },
    });

    if (!regraExistente) {
      throw new Error('Regra de exclusão não encontrada ou não pertence ao usuário.');
    }

    const atualizada = await this.prisma.regraExclusaoMedia.update({
      where: { id },
      data: {
        categoriaId: dados.categoriaId !== undefined ? dados.categoriaId : undefined,
        descricaoPadrao:
          dados.descricaoPadrao !== undefined ? dados.descricaoPadrao : undefined,
        valorMinimo: dados.valorMinimo !== undefined ? dados.valorMinimo : undefined,
        apenasUmaVez: dados.apenasUmaVez !== undefined ? dados.apenasUmaVez : undefined,
        ativo: dados.ativo !== undefined ? dados.ativo : undefined,
        motivo: dados.motivo !== undefined ? dados.motivo : undefined,
      },
      include: {
        categoria: {
          select: { id: true, nome: true },
        },
      },
    });

    await motorExclusaoMediaService.consolidarMedias(usuarioId);
    return atualizada;
  }

  public async excluirRegra(usuarioId: string, id: string) {
    const regra = await this.prisma.regraExclusaoMedia.findFirst({
      where: { id, usuarioId },
    });

    if (!regra) {
      throw new Error('Regra não encontrada para exclusão.');
    }

    await this.prisma.regraExclusaoMedia.delete({
      where: { id },
    });

    await motorExclusaoMediaService.consolidarMedias(usuarioId);
    return { sucesso: true, id };
  }

  // --- CRUD DE EXCLUSÕES DE LANÇAMENTOS (INCLUIR / RESTAURAR / LISTAR) ---

  public async listarExclusoes(usuarioId: string) {
    return await this.prisma.exclusaoMovimentoMedia.findMany({
      where: { usuarioId },
      include: {
        movimento: {
          include: {
            categoria: {
              select: { id: true, nome: true },
            },
            conta: {
              select: { id: true, nome: true },
            },
          },
        },
      },
      orderBy: { criadoEm: 'desc' },
    });
  }

  public async incluirExclusaoManual(
    usuarioId: string,
    movimentoId: string,
    motivo: string
  ) {
    const movimento = await this.prisma.movimento.findFirst({
      where: { id: movimentoId, usuarioId },
    });

    if (!movimento) {
      throw new Error('Lançamento não encontrado ou não pertence ao usuário.');
    }

    const exclusao = await this.prisma.exclusaoMovimentoMedia.upsert({
      where: {
        usuarioId_movimentoId: {
          usuarioId,
          movimentoId,
        },
      },
      create: {
        usuarioId,
        movimentoId,
        motivo,
        origem: 'MANUAL',
        ativo: true,
      },
      update: {
        motivo,
        origem: 'MANUAL',
        ativo: true,
        atualizadoEm: new Date(),
      },
      include: {
        movimento: true,
      },
    });

    await motorExclusaoMediaService.consolidarMedias(usuarioId);
    return exclusao;
  }

  public async alternarStatusExclusao(usuarioId: string, exclusaoId: string, ativo: boolean) {
    const exclusao = await this.prisma.exclusaoMovimentoMedia.findFirst({
      where: { id: exclusaoId, usuarioId },
    });

    if (!exclusao) {
      throw new Error('Registro de exclusão não encontrado.');
    }

    const atualizado = await this.prisma.exclusaoMovimentoMedia.update({
      where: { id: exclusaoId },
      data: {
        ativo,
        atualizadoEm: new Date(),
      },
      include: {
        movimento: true,
      },
    });

    await motorExclusaoMediaService.consolidarMedias(usuarioId);
    return atualizado;
  }

  public async removerExclusao(usuarioId: string, exclusaoId: string) {
    const exclusao = await this.prisma.exclusaoMovimentoMedia.findFirst({
      where: { id: exclusaoId, usuarioId },
    });

    if (!exclusao) {
      throw new Error('Registro de exclusão não encontrado.');
    }

    await this.prisma.exclusaoMovimentoMedia.delete({
      where: { id: exclusaoId },
    });

    await motorExclusaoMediaService.consolidarMedias(usuarioId);
    return { sucesso: true, exclusaoId };
  }

  // --- PESQUISA DE LANÇAMENTOS PARA O USUÁRIO PODER EXCLUIR OU INCLUIR NA MÉDIA ---

  public async pesquisarLancamentos(
    usuarioId: string,
    params: PesquisaLancamentosParams
  ) {
    const nMeses = await configuracaoService.obterMesesJanelaUsuario(usuarioId);
    const mesesAnalisados = calcularUltimosMesesFechados(undefined, nMeses);

    const where: any = {
      usuarioId,
      natureza: 'DESPESA',
      status: 'CONCILIADO',
      competencia: params.competencia ? params.competencia : { in: mesesAnalisados },
    };

    if (params.termo && params.termo.trim().length > 0) {
      where.descricao = {
        contains: params.termo.trim(),
        mode: 'insensitive',
      };
    }

    if (params.categoriaId) {
      where.categoriaId = params.categoriaId;
    }

    const movimentos = await this.prisma.movimento.findMany({
      where,
      include: {
        categoria: {
          select: { id: true, nome: true },
        },
        conta: {
          select: { id: true, nome: true },
        },
        exclusoesMedia: {
          where: { usuarioId },
          select: { id: true, motivo: true, origem: true, ativo: true },
        },
      },
      orderBy: { dataMovimento: 'desc' },
      take: params.limite || 50,
    });

    const formatados = movimentos.map((m) => {
      const exc = m.exclusoesMedia[0];
      return {
        id: m.id,
        dataMovimento: m.dataMovimento,
        competencia: m.competencia,
        descricao: m.descricao,
        valor: Number(m.valor),
        categoriaId: m.categoriaId,
        categoriaNome: m.categoria?.nome || 'Sem categoria',
        contaNome: m.conta.nome,
        excluidoDaMedia: exc ? exc.ativo : false,
        exclusaoId: exc ? exc.id : null,
        motivoExclusao: exc ? exc.motivo : null,
        origemExclusao: exc ? exc.origem : null,
      };
    });

    if (params.apenasExcluidos) {
      return formatados.filter((item) => item.excluidoDaMedia);
    }

    return formatados;
  }

  // --- CONSULTA DA TABELA CONSOLIDADA ---

  public async obterMediasConsolidadas(
    usuarioId: string,
    competenciaRef?: string,
    mesesJanela?: number
  ) {
    const nMeses =
      mesesJanela && mesesJanela >= 3 && mesesJanela <= 12
        ? mesesJanela
        : await configuracaoService.obterMesesJanelaUsuario(usuarioId);

    let compInicio = competenciaRef;
    if (!compInicio) {
      const agora = new Date();
      compInicio = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
    }

    // Busca tabela consolidada
    let itens = await this.prisma.mediaMensalConsolidada.findMany({
      where: {
        usuarioId,
        competenciaReferencia: compInicio,
        mesesJanela: nMeses,
      },
      include: {
        categoria: {
          select: { id: true, nome: true, ordem: true },
        },
      },
      orderBy: [
        { categoriaId: 'asc' },
      ],
    });

    // Se ainda não foi consolidado para este corte, executa consolidação imediatamente
    if (itens.length === 0) {
      await motorExclusaoMediaService.consolidarMedias(usuarioId, nMeses, compInicio);
      itens = await this.prisma.mediaMensalConsolidada.findMany({
        where: {
          usuarioId,
          competenciaReferencia: compInicio,
          mesesJanela: nMeses,
        },
        include: {
          categoria: {
            select: { id: true, nome: true, ordem: true },
          },
        },
      });
    }

    const global = itens.find((i) => i.categoriaId === null);
    const categorias = itens
      .filter((i) => i.categoriaId !== null)
      .map((i) => ({
        categoriaId: i.categoriaId,
        nome: i.categoria?.nome || 'Desconhecida',
        ordem: i.categoria?.ordem ?? 0,
        totalPeriodoBruto: Number(i.totalPeriodoBruto),
        totalExcluido: Number(i.totalExcluido),
        totalPeriodoEfetivo: Number(i.totalPeriodoEfetivo),
        mediaMensalEfetiva: Number(i.mediaMensalEfetiva),
        qtdLancamentosTotais: i.qtdLancamentosTotais,
        qtdLancamentosExcluidos: i.qtdLancamentosExcluidos,
      }))
      .sort((a, b) => a.ordem - b.ordem);

    return {
      competenciaReferencia: compInicio,
      mesesJanela: nMeses,
      global: global
        ? {
            totalPeriodoBruto: Number(global.totalPeriodoBruto),
            totalExcluido: Number(global.totalExcluido),
            totalPeriodoEfetivo: Number(global.totalPeriodoEfetivo),
            mediaMensalEfetiva: Number(global.mediaMensalEfetiva),
            qtdLancamentosTotais: global.qtdLancamentosTotais,
            qtdLancamentosExcluidos: global.qtdLancamentosExcluidos,
          }
        : null,
      categorias,
    };
  }
}

export const mediaMensalService = new MediaMensalService();
