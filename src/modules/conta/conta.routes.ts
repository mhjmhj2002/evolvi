import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ensureAuthenticated } from '../../middlewares/auth.middleware.js';
import { createContaSchema, updateContaSchema, migrarMovimentosContaSchema } from './conta.schema.js';

export const contaRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addHook('preHandler', ensureAuthenticated);

  // GET /api/contas
  app.get('/', async (request, reply) => {
    const usuarioId = request.user.sub;

    const contas = await prisma.conta.findMany({
      where: { usuarioId },
      orderBy: { criadoEm: 'asc' },
    });

    return reply.status(200).send({
      contas: contas.map((conta) => ({
        ...conta,
        saldoInicial: Number(conta.saldoInicial),
      })),
    });
  });

  // GET /api/contas/:id/dependencias - Retorna os lançamentos e parcelamentos vinculados para conferência prévia
  app.get('/:id/dependencias', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params as { id: string };

    const conta = await prisma.conta.findFirst({
      where: { id, usuarioId },
      include: {
        _count: {
          select: {
            movimentos: true,
            parcelamentos: true,
          },
        },
      },
    });

    if (!conta) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Conta não encontrada.',
      });
    }

    const movimentos = await prisma.movimento.findMany({
      where: { contaId: id, usuarioId },
      select: {
        id: true,
        dataMovimento: true,
        competencia: true,
        descricao: true,
        valor: true,
        natureza: true,
        status: true,
      },
      orderBy: { dataMovimento: 'desc' },
      take: 100, // Limite para visualização limpa
    });

    const parcelamentos = await prisma.parcelamento.findMany({
      where: { contaId: id, usuarioId },
      select: {
        id: true,
        descricao: true,
        valorTotal: true,
        parcelaValor: true,
        totalParcelas: true,
        parcelaAtual: true,
        status: true,
      },
    });

    return reply.status(200).send({
      conta: {
        id: conta.id,
        nome: conta.nome,
        tipo: conta.tipo,
      },
      totalMovimentos: conta._count.movimentos,
      totalParcelamentos: conta._count.parcelamentos,
      podeExcluirDiretamente: conta._count.movimentos === 0 && conta._count.parcelamentos === 0,
      movimentos: movimentos.map((m) => ({
        ...m,
        valor: Number(m.valor),
      })),
      parcelamentos: parcelamentos.map((p) => ({
        ...p,
        valorTotal: Number(p.valorTotal),
        parcelaValor: Number(p.parcelaValor),
      })),
    });
  });

  // POST /api/contas/:id/migrar-movimentos - Transfere lançamentos e parcelamentos para outra conta do usuário
  app.post('/:id/migrar-movimentos', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params as { id: string };

    const parseResult = migrarMovimentosContaSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados inválidos para migração de lançamentos.',
        issues: parseResult.error.issues,
      });
    }

    const { contaDestinoId } = parseResult.data;

    if (contaDestinoId === id) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'A conta de destino não pode ser a mesma conta de origem.',
      });
    }

    const [contaOrigem, contaDestino] = await Promise.all([
      prisma.conta.findFirst({ where: { id, usuarioId } }),
      prisma.conta.findFirst({ where: { id: contaDestinoId, usuarioId } }),
    ]);

    if (!contaOrigem) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Conta de origem não encontrada.',
      });
    }

    if (!contaDestino) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Conta de destino não encontrada.',
      });
    }

    // Executa migração atômica de movimentos e parcelamentos
    const resultado = await prisma.$transaction(async (tx) => {
      const resMovs = await tx.movimento.updateMany({
        where: { contaId: id, usuarioId },
        data: { contaId: contaDestinoId },
      });

      const resParcs = await tx.parcelamento.updateMany({
        where: { contaId: id, usuarioId },
        data: { contaId: contaDestinoId },
      });

      return {
        movimentosMigrados: resMovs.count,
        parcelamentosMigrados: resParcs.count,
      };
    });

    return reply.status(200).send({
      message: `Migração concluída com sucesso para a conta "${contaDestino.nome}".`,
      origemId: id,
      destinoId: contaDestinoId,
      ...resultado,
    });
  });

  // DELETE /api/contas/:id/movimentos - Exclui todos os lançamentos vinculados à conta para permitir a posterior exclusão da conta
  app.delete('/:id/movimentos', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params as { id: string };

    const conta = await prisma.conta.findFirst({
      where: { id, usuarioId },
    });

    if (!conta) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Conta não encontrada.',
      });
    }

    const resultado = await prisma.$transaction(async (tx) => {
      // 1. Desvincular transferências mútuas antes de deletar
      await tx.movimento.updateMany({
        where: { contaId: id, usuarioId },
        data: { transferenciaVinculoId: null },
      });

      // 2. Deletar os movimentos da conta
      const movsDeletados = await tx.movimento.deleteMany({
        where: { contaId: id, usuarioId },
      });

      // 3. Deletar ou cancelar parcelamentos associados
      const parcsDeletados = await tx.parcelamento.deleteMany({
        where: { contaId: id, usuarioId },
      });

      return {
        movimentosExcluidos: movsDeletados.count,
        parcelamentosExcluidos: parcsDeletados.count,
      };
    });

    return reply.status(200).send({
      message: 'Todos os lançamentos vinculados à conta foram excluídos com sucesso.',
      ...resultado,
    });
  });

  // POST /api/contas
  app.post('/', async (request, reply) => {
    const usuarioId = request.user.sub;

    const parseResult = createContaSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados inválidos para criação da conta',
        issues: parseResult.error.issues,
      });
    }

    const data = parseResult.data;

    const novaConta = await prisma.conta.create({
      data: {
        usuarioId,
        nome: data.nome,
        tipo: data.tipo,
        diaFechamento: data.diaFechamento ?? null,
        diaVencimento: data.diaVencimento ?? null,
        saldoInicial: data.saldoInicial,
        ativo: data.ativo ?? true,
      },
    });

    return reply.status(201).send({
      message: 'Conta criada com sucesso',
      conta: {
        ...novaConta,
        saldoInicial: Number(novaConta.saldoInicial),
      },
    });
  });

  // PUT /api/contas/:id
  app.put('/:id', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params as { id: string };

    const contaExistente = await prisma.conta.findFirst({
      where: { id, usuarioId },
    });

    if (!contaExistente) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Conta não encontrada.',
      });
    }

    const parseResult = updateContaSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados inválidos para atualização da conta',
        issues: parseResult.error.issues,
      });
    }

    const data = parseResult.data;

    // Se o tipo resultante for CARTAO_CREDITO (atualizado ou mantido), validar diaFechamento e diaVencimento
    const tipoFinal = data.tipo ?? contaExistente.tipo;
    const diaFechamentoFinal = data.diaFechamento !== undefined ? data.diaFechamento : contaExistente.diaFechamento;
    const diaVencimentoFinal = data.diaVencimento !== undefined ? data.diaVencimento : contaExistente.diaVencimento;

    if (tipoFinal === 'CARTAO_CREDITO') {
      if (diaFechamentoFinal === null || diaFechamentoFinal === undefined) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Dia de fechamento é obrigatório para cartão de crédito',
        });
      }
      if (diaVencimentoFinal === null || diaVencimentoFinal === undefined) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Dia de vencimento é obrigatório para cartão de crédito',
        });
      }
    }

    const contaAtualizada = await prisma.conta.update({
      where: { id },
      data: {
        ...(data.nome !== undefined && { nome: data.nome }),
        ...(data.tipo !== undefined && { tipo: data.tipo }),
        ...(data.diaFechamento !== undefined && { diaFechamento: data.diaFechamento }),
        ...(data.diaVencimento !== undefined && { diaVencimento: data.diaVencimento }),
        ...(data.saldoInicial !== undefined && { saldoInicial: data.saldoInicial }),
        ...(data.ativo !== undefined && { ativo: data.ativo }),
      },
    });

    return reply.status(200).send({
      message: 'Conta atualizada com sucesso',
      conta: {
        ...contaAtualizada,
        saldoInicial: Number(contaAtualizada.saldoInicial),
      },
    });
  });

  // DELETE /api/contas/:id
  app.delete('/:id', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params as { id: string };

    const conta = await prisma.conta.findFirst({
      where: { id, usuarioId },
      include: {
        _count: {
          select: {
            movimentos: true,
            parcelamentos: true,
          },
        },
      },
    });

    if (!conta) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Conta não encontrada.',
      });
    }

    // Regra de Integridade: Bloqueio de exclusão caso haja registros vinculados
    if (conta._count.movimentos > 0 || conta._count.parcelamentos > 0) {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: 'Não é possível excluir esta conta pois existem movimentações ou parcelamentos vinculados a ela.',
        detalhes: {
          movimentosCount: conta._count.movimentos,
          parcelamentosCount: conta._count.parcelamentos,
        },
      });
    }

    await prisma.conta.delete({
      where: { id },
    });

    return reply.status(200).send({
      message: 'Conta removida com sucesso.',
      id,
    });
  });
};
