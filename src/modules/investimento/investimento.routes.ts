import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ensureAuthenticated } from '../../middlewares/auth.middleware.js';
import { createAporteManualSchema, queryAportesSchema } from './investimento.schema.js';
import { gerarChaveDedupe } from '../movimento/movimento.util.js';

export const investimentoRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Todas as rotas de investimento exigem autenticação rigorosa
  app.addHook('preHandler', ensureAuthenticated);

  /**
   * GET /api/investimentos/aportes
   * Lista movimentações com natureza APORTE_PATRIMONIAL de forma paginada e agregada (KPIs e resumo)
   */
  app.get('/aportes', async (request, reply) => {
    const usuarioId = request.user.sub;

    const queryParse = queryAportesSchema.safeParse(request.query);
    if (!queryParse.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Parâmetros de consulta inválidos.',
        issues: queryParse.error.issues,
      });
    }

    const { competencia, dataInicio, dataFim, contaId, busca, page, limit } = queryParse.data;

    const dataFiltro: any = {};
    if (dataInicio) {
      dataFiltro.gte = new Date(`${dataInicio}T00:00:00.000Z`);
    }
    if (dataFim) {
      dataFiltro.lte = new Date(`${dataFim}T23:59:59.999Z`);
    }

    const whereClause: any = {
      usuarioId,
      natureza: 'APORTE_PATRIMONIAL',
      status: 'CONCILIADO',
      ...(competencia && { competencia }),
      ...(contaId && { contaId }),
      ...(Object.keys(dataFiltro).length > 0 && { dataMovimento: dataFiltro }),
      ...(busca && {
        OR: [
          { descricao: { contains: busca, mode: 'insensitive' } },
          { observacao: { contains: busca, mode: 'insensitive' } },
        ],
      }),
    };

    // Total de registros com filtros aplicados
    const totalCount = await prisma.movimento.count({ where: whereClause });

    // Busca paginada
    const aportes = await prisma.movimento.findMany({
      where: whereClause,
      include: {
        conta: {
          select: {
            id: true,
            nome: true,
            tipo: true,
          },
        },
        categoria: {
          select: {
            id: true,
            nome: true,
          },
        },
      },
      orderBy: [{ dataMovimento: 'desc' }, { criadoEm: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    });

    // Busca agregada para KPIs do período/competência selecionada
    const agregados = await prisma.movimento.aggregate({
      where: whereClause,
      _sum: {
        valor: true,
      },
      _count: {
        id: true,
      },
      _max: {
        dataMovimento: true,
      },
    });

    const totalAportado = agregados._sum.valor ? Number(agregados._sum.valor) : 0;
    const quantidadeAportes = agregados._count.id || 0;
    const ultimaAplicacao = agregados._max.dataMovimento
      ? agregados._max.dataMovimento.toISOString().split('T')[0]
      : null;

    const aportesFormatados = aportes.map((mov) => {
      const valorNum = Number(mov.valor);

      // Detecta produto financeiro se presente ou infere da descrição
      let produtoFinanceiro = 'Aplicação Financeira';
      const descUpper = mov.descricao.toUpperCase();
      if (descUpper.includes('CDB')) produtoFinanceiro = 'CDB';
      else if (descUpper.includes('RDB')) produtoFinanceiro = 'RDB';
      else if (descUpper.includes('LCI')) produtoFinanceiro = 'LCI';
      else if (descUpper.includes('LCA')) produtoFinanceiro = 'LCA';
      else if (descUpper.includes('TESOURO')) produtoFinanceiro = 'Tesouro Direto';
      else if (descUpper.includes('POUPANCA') || descUpper.includes('POUPANÇA')) produtoFinanceiro = 'Poupança';
      else if (descUpper.includes('FII') || descUpper.includes('11')) produtoFinanceiro = 'Fundo Imobiliário (FII)';
      else if (descUpper.includes('ACAO') || descUpper.includes('AÇÕES') || descUpper.includes('ACOES') || descUpper.includes('B3')) produtoFinanceiro = 'Ações / Renda Variável';
      else if (descUpper.includes('FUNDO')) produtoFinanceiro = 'Fundo de Investimento';

      return {
        id: mov.id,
        contaId: mov.contaId,
        conta: mov.conta,
        categoriaId: mov.categoriaId,
        categoria: mov.categoria,
        dataMovimento: mov.dataMovimento.toISOString().split('T')[0],
        competencia: mov.competencia,
        descricao: mov.descricao,
        produtoTipo: produtoFinanceiro,
        valor: valorNum,
        natureza: mov.natureza,
        status: mov.status,
        categoriaFixadaPeloUsuario: mov.categoriaFixadaPeloUsuario,
        observacao: mov.observacao,
        origemDocumento: mov.origemDocumento,
        criadoEm: mov.criadoEm,
      };
    });

    return reply.status(200).send({
      resumo: {
        totalAportado: Number(totalAportado.toFixed(2)),
        quantidadeAportes,
        ultimaAplicacao,
      },
      paginacao: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit) || 1,
      },
      aportes: aportesFormatados,
    });
  });

  /**
   * POST /api/investimentos/aportes
   * Criação manual de aporte pelo usuário (natureza APORTE_PATRIMONIAL, categoriaFixadaPeloUsuario: true)
   */
  app.post('/aportes', async (request, reply) => {
    const usuarioId = request.user.sub;

    const parseResult = createAporteManualSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados inválidos para registro do aporte manual.',
        issues: parseResult.error.issues,
      });
    }

    const data = parseResult.data;

    // 1. Validar que a conta informada pertence ao usuário autenticado (isolamento multi-tenant)
    const conta = await prisma.conta.findFirst({
      where: {
        id: data.contaId,
        usuarioId,
      },
    });

    if (!conta) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Conta de origem não encontrada ou não pertence ao usuário.',
      });
    }

    // 2. Buscar categoria de Investimentos padrão (sistema ou usuário)
    let categoriaInvestimentos = await prisma.categoria.findFirst({
      where: {
        OR: [
          { nome: { equals: 'Aplicações / Investimentos', mode: 'insensitive' } },
          { nome: { equals: 'Investimentos', mode: 'insensitive' } },
        ],
        AND: [
          {
            OR: [{ usuarioId: null }, { usuarioId }],
          },
        ],
      },
    });

    if (!categoriaInvestimentos) {
      // Fallback: busca qualquer categoria de investimento ou cria uma para o usuário
      categoriaInvestimentos = await prisma.categoria.findFirst({
        where: {
          nome: { contains: 'Invest', mode: 'insensitive' },
          OR: [{ usuarioId: null }, { usuarioId }],
        },
      });
    }

    const dataMovimentoDate = new Date(`${data.dataAporte}T00:00:00.000Z`);
    const competencia = data.dataAporte.substring(0, 7);

    // Gera chave dedupe canônica para prevenir duplicação acidental
    const chaveDedupeCalculada = gerarChaveDedupe({
      contaId: data.contaId,
      dataMovimento: data.dataAporte,
      valor: data.valor,
      descricao: data.descricao,
    });

    const aporteExistente = await prisma.movimento.findFirst({
      where: {
        usuarioId,
        chaveDedupe: chaveDedupeCalculada,
      },
    });

    if (aporteExistente) {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: 'Já existe um aporte idêntico cadastrado nesta data para esta conta.',
        movimentoExistenteId: aporteExistente.id,
      });
    }

    // Inclusão do movimento patrimonial
    const novoAporte = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: data.contaId,
        categoriaId: categoriaInvestimentos?.id ?? null,
        dataMovimento: dataMovimentoDate,
        competencia,
        descricao: data.descricao,
        valor: data.valor,
        natureza: 'APORTE_PATRIMONIAL',
        status: 'CONCILIADO',
        chaveDedupe: chaveDedupeCalculada,
        categoriaFixadaPeloUsuario: true, // Imunizado contra reclassificações automáticas
        validadoDedupe: 'S',
        observacao: data.observacao || (data.produtoTipo ? `Tipo: ${data.produtoTipo}` : null),
        origemDocumento: 'CADASTRO_MANUAL_APORTE',
      },
      include: {
        conta: {
          select: {
            id: true,
            nome: true,
            tipo: true,
          },
        },
        categoria: {
          select: {
            id: true,
            nome: true,
          },
        },
      },
    });

    return reply.status(201).send({
      message: 'Aporte registrado com sucesso!',
      aporte: {
        id: novoAporte.id,
        contaId: novoAporte.contaId,
        conta: novoAporte.conta,
        categoriaId: novoAporte.categoriaId,
        categoria: novoAporte.categoria,
        dataMovimento: data.dataAporte,
        competencia: novoAporte.competencia,
        descricao: novoAporte.descricao,
        valor: Number(novoAporte.valor),
        natureza: novoAporte.natureza,
        status: novoAporte.status,
        categoriaFixadaPeloUsuario: novoAporte.categoriaFixadaPeloUsuario,
        observacao: novoAporte.observacao,
        origemDocumento: novoAporte.origemDocumento,
        criadoEm: novoAporte.criadoEm,
      },
    });
  });
};
