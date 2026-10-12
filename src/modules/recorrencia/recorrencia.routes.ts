import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ensureAuthenticated } from '../../middlewares/auth.middleware.js';
import {
  createRecorrenciaSchema,
  updateRecorrenciaSchema,
  queryRecorrenciaSchema,
} from './recorrencia.schema.js';

export const recorrenciaRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addHook('preHandler', ensureAuthenticated);

  // GET /api/recorrencias
  app.get('/', async (request, reply) => {
    const usuarioId = request.user.sub;
    const query = queryRecorrenciaSchema.safeParse(request.query);

    const where: any = { usuarioId };
    if (query.success) {
      if (query.data.essencial !== undefined) {
        where.essencial = query.data.essencial;
      }
      if (query.data.status) {
        where.status = query.data.status;
      }
    }

    const recorrencias = await prisma.recorrencia.findMany({
      where,
      include: {
        categoria: {
          select: {
            id: true,
            nome: true,
          },
        },
      },
      orderBy: [
        { diaPrevisto: 'asc' },
        { criadoEm: 'asc' },
      ],
    });

    return reply.status(200).send({
      recorrencias: recorrencias.map((rec) => ({
        ...rec,
        valorReferencia: Number(rec.valorReferencia),
      })),
    });
  });

  // POST /api/recorrencias
  app.post('/', async (request, reply) => {
    const usuarioId = request.user.sub;

    const parseResult = createRecorrenciaSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados inválidos para criação do compromisso recorrente',
        issues: parseResult.error.issues,
      });
    }

    const data = parseResult.data;

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
          message: 'Categoria não encontrada ou não pertence ao usuário',
        });
      }
    }

    const recorrencia = await prisma.recorrencia.create({
      data: {
        usuarioId,
        categoriaId: data.categoriaId ?? null,
        descricao: data.descricao,
        valorReferencia: data.valorReferencia,
        diaPrevisto: data.diaPrevisto ?? null,
        formaPagamento: data.formaPagamento ?? null,
        essencial: data.essencial ?? true,
        status: data.status ?? 'ATIVA',
      },
      include: {
        categoria: {
          select: {
            id: true,
            nome: true,
          },
        },
      },
    });

    return reply.status(201).send({
      message: 'Compromisso recorrente criado com sucesso',
      recorrencia: {
        ...recorrencia,
        valorReferencia: Number(recorrencia.valorReferencia),
      },
    });
  });

  // PUT /api/recorrencias/:id
  app.put('/:id', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params as { id: string };

    const parseResult = updateRecorrenciaSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados inválidos para atualização do compromisso recorrente',
        issues: parseResult.error.issues,
      });
    }

    const recorrenciaExistente = await prisma.recorrencia.findFirst({
      where: { id, usuarioId },
    });

    if (!recorrenciaExistente) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Compromisso recorrente não encontrado',
      });
    }

    const data = parseResult.data;

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
          message: 'Categoria não encontrada ou não pertence ao usuário',
        });
      }
    }

    const recorrenciaAtualizada = await prisma.recorrencia.update({
      where: { id },
      data: {
        ...(data.categoriaId !== undefined ? { categoriaId: data.categoriaId } : {}),
        ...(data.descricao !== undefined ? { descricao: data.descricao } : {}),
        ...(data.valorReferencia !== undefined ? { valorReferencia: data.valorReferencia } : {}),
        ...(data.diaPrevisto !== undefined ? { diaPrevisto: data.diaPrevisto } : {}),
        ...(data.formaPagamento !== undefined ? { formaPagamento: data.formaPagamento } : {}),
        ...(data.essencial !== undefined ? { essencial: data.essencial } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
      include: {
        categoria: {
          select: {
            id: true,
            nome: true,
          },
        },
      },
    });

    return reply.status(200).send({
      message: 'Compromisso recorrente atualizado com sucesso',
      recorrencia: {
        ...recorrenciaAtualizada,
        valorReferencia: Number(recorrenciaAtualizada.valorReferencia),
      },
    });
  });

  // DELETE /api/recorrencias/:id
  app.delete('/:id', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params as { id: string };

    const recorrenciaExistente = await prisma.recorrencia.findFirst({
      where: { id, usuarioId },
    });

    if (!recorrenciaExistente) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Compromisso recorrente não encontrado',
      });
    }

    await prisma.recorrencia.delete({
      where: { id },
    });

    return reply.status(200).send({
      message: 'Compromisso recorrente removido com sucesso',
    });
  });
};
