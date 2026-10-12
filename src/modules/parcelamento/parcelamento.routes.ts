import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ensureAuthenticated } from '../../middlewares/auth.middleware.js';
import {
  createParcelamentoSchema,
  updateParcelamentoSchema,
  queryParcelamentoSchema,
} from './parcelamento.schema.js';
import { addMesesCompetencia, formatarParcelamento } from './parcelamento.util.js';

export const parcelamentoRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addHook('preHandler', ensureAuthenticated);

  // GET /api/parcelamentos
  app.get('/', async (request, reply) => {
    const usuarioId = request.user.sub;
    const query = queryParcelamentoSchema.safeParse(request.query);

    const where: any = { usuarioId };
    if (query.success) {
      if (query.data.status) {
        where.status = query.data.status;
      }
      if (query.data.contaId) {
        where.contaId = query.data.contaId;
      }
    }

    const parcelamentos = await prisma.parcelamento.findMany({
      where,
      include: {
        conta: {
          select: {
            id: true,
            nome: true,
            tipo: true,
            diaVencimento: true,
          },
        },
        categoria: {
          select: {
            id: true,
            nome: true,
          },
        },
      },
      orderBy: [
        { ultimoVencimento: 'asc' },
        { criadoEm: 'asc' },
      ],
    });

    const formatados = parcelamentos.map(formatarParcelamento);
    const saldoDevedorTotalGeral = formatados
      .filter((p) => p.status === 'ATIVO')
      .reduce((acc, p) => acc + p.saldoDevedorRestante, 0);

    return reply.status(200).send({
      saldoDevedorTotalGeral: Number(saldoDevedorTotalGeral.toFixed(2)),
      totalParcelamentosAtivos: formatados.filter((p) => p.status === 'ATIVO').length,
      parcelamentos: formatados,
    });
  });

  // POST /api/parcelamentos
  app.post('/', async (request, reply) => {
    const usuarioId = request.user.sub;

    const parseResult = createParcelamentoSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados inválidos para criação do parcelamento',
        issues: parseResult.error.issues,
      });
    }

    const data = parseResult.data;

    // Validar conta se informada
    if (data.contaId) {
      const conta = await prisma.conta.findFirst({
        where: { id: data.contaId, usuarioId },
      });
      if (!conta) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Conta informada não encontrada ou não pertence ao usuário',
        });
      }
    }

    // Validar categoria se informada
    if (data.categoriaId) {
      const categoria = await prisma.categoria.findFirst({
        where: {
          id: data.categoriaId,
          OR: [{ usuarioId }, { usuarioId: null }],
        },
      });
      if (!categoria) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Categoria informada não encontrada ou não pertence ao usuário',
        });
      }
    }

    // Calcular parcelaValor automaticamente se não informado
    const parcelaValor = data.parcelaValor ?? Number((data.valorTotal / data.totalParcelas).toFixed(2));

    // Calcular ultimoVencimento se não informado a partir do primeiroVencimento e totalParcelas
    // Se primeiroVencimento = 2026-10 e totalParcelas = 3: parcelas em 2026-10, 2026-11, 2026-12 -> ultimo = addMesesCompetencia(primeiro, 2)
    const ultimoVencimento = data.ultimoVencimento ?? addMesesCompetencia(data.primeiroVencimento, data.totalParcelas - 1);

    const parcelamento = await prisma.parcelamento.create({
      data: {
        usuarioId,
        contaId: data.contaId ?? null,
        categoriaId: data.categoriaId ?? null,
        descricao: data.descricao,
        valorTotal: data.valorTotal,
        parcelaValor,
        parcelaAtual: data.parcelaAtual,
        totalParcelas: data.totalParcelas,
        primeiroVencimento: data.primeiroVencimento,
        ultimoVencimento,
        status: data.status ?? 'ATIVO',
      },
      include: {
        conta: {
          select: {
            id: true,
            nome: true,
            tipo: true,
            diaVencimento: true,
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

    const formatado = formatarParcelamento(parcelamento);

    return reply.status(201).send({
      message: 'Parcelamento criado com sucesso',
      parcelamento: formatado,
    });
  });

  // PUT /api/parcelamentos/:id
  app.put('/:id', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params as { id: string };

    const parseResult = updateParcelamentoSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados inválidos para atualização do parcelamento',
        issues: parseResult.error.issues,
      });
    }

    const parcelamentoExistente = await prisma.parcelamento.findFirst({
      where: { id, usuarioId },
    });

    if (!parcelamentoExistente) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Parcelamento não encontrado',
      });
    }

    const data = parseResult.data;

    if (data.contaId) {
      const conta = await prisma.conta.findFirst({
        where: { id: data.contaId, usuarioId },
      });
      if (!conta) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Conta informada não encontrada ou não pertence ao usuário',
        });
      }
    }

    if (data.categoriaId) {
      const categoria = await prisma.categoria.findFirst({
        where: {
          id: data.categoriaId,
          OR: [{ usuarioId }, { usuarioId: null }],
        },
      });
      if (!categoria) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Categoria informada não encontrada ou não pertence ao usuário',
        });
      }
    }

    // Verificar coerência de parcelaAtual e totalParcelas
    const novaParcelaAtual = data.parcelaAtual ?? parcelamentoExistente.parcelaAtual;
    const novoTotalParcelas = data.totalParcelas ?? parcelamentoExistente.totalParcelas;
    if (novaParcelaAtual > novoTotalParcelas) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'A parcela atual não pode ser superior ao total de parcelas',
      });
    }

    const parcelamentoAtualizado = await prisma.parcelamento.update({
      where: { id },
      data: {
        ...(data.contaId !== undefined ? { contaId: data.contaId } : {}),
        ...(data.categoriaId !== undefined ? { categoriaId: data.categoriaId } : {}),
        ...(data.descricao !== undefined ? { descricao: data.descricao } : {}),
        ...(data.valorTotal !== undefined ? { valorTotal: data.valorTotal } : {}),
        ...(data.parcelaValor !== undefined ? { parcelaValor: data.parcelaValor } : {}),
        ...(data.parcelaAtual !== undefined ? { parcelaAtual: data.parcelaAtual } : {}),
        ...(data.totalParcelas !== undefined ? { totalParcelas: data.totalParcelas } : {}),
        ...(data.primeiroVencimento !== undefined ? { primeiroVencimento: data.primeiroVencimento } : {}),
        ...(data.ultimoVencimento !== undefined ? { ultimoVencimento: data.ultimoVencimento } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
      include: {
        conta: {
          select: {
            id: true,
            nome: true,
            tipo: true,
            diaVencimento: true,
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

    return reply.status(200).send({
      message: 'Parcelamento atualizado com sucesso',
      parcelamento: formatarParcelamento(parcelamentoAtualizado),
    });
  });

  // DELETE /api/parcelamentos/:id
  app.delete('/:id', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params as { id: string };

    const parcelamentoExistente = await prisma.parcelamento.findFirst({
      where: { id, usuarioId },
    });

    if (!parcelamentoExistente) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Parcelamento não encontrado',
      });
    }

    await prisma.parcelamento.delete({
      where: { id },
    });

    return reply.status(200).send({
      message: 'Parcelamento removido com sucesso',
    });
  });
};
