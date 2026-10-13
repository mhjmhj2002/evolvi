import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ensureAuthenticated } from '../../middlewares/auth.middleware.js';
import {
  createMovimentoSchema,
  updateMovimentoSchema,
  queryMovimentosSchema,
  importarMovimentosSchema,
} from './movimento.schema.js';
import { gerarChaveDedupe } from './movimento.util.js';

export const movimentoRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addHook('preHandler', ensureAuthenticated);

  // GET /api/movimentos (extrato filtrado com totalizadores separados para consumo real vs transferências/faturas)
  app.get('/', async (request, reply) => {
    const usuarioId = request.user.sub;

    const queryParse = queryMovimentosSchema.safeParse(request.query);
    if (!queryParse.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Parâmetros de busca inválidos',
        issues: queryParse.error.issues,
      });
    }

    const { competencia, dataInicio, dataFim, busca, contaId, categoriaId, natureza, status } = queryParse.data;

    const dataFiltro: any = {};
    if (dataInicio) {
      dataFiltro.gte = new Date(`${dataInicio}T00:00:00.000Z`);
    }
    if (dataFim) {
      dataFiltro.lte = new Date(`${dataFim}T23:59:59.999Z`);
    }

    const whereClause: any = {
      usuarioId,
      ...(competencia && { competencia }),
      ...(contaId && { contaId }),
      ...(categoriaId && { categoriaId }),
      ...(natureza && { natureza }),
      ...(status && { status }),
      ...(Object.keys(dataFiltro).length > 0 && { dataMovimento: dataFiltro }),
      ...(busca && {
        OR: [
          { descricao: { contains: busca, mode: 'insensitive' } },
          { observacao: { contains: busca, mode: 'insensitive' } },
        ],
      }),
    };

    const movimentos = await prisma.movimento.findMany({
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
            categoriaPaiId: true,
          },
        },
      },
      orderBy: [{ dataMovimento: 'desc' }, { criadoEm: 'desc' }],
    });

    // Cálculos de totalizadores canônicos para visualização e anti-dupla contagem
    let totalReceitas = 0;
    let totalDespesasConsumo = 0;
    let totalTransferenciasProprias = 0;
    let totalAportesPatrimoniais = 0;

    const movimentosFormatados = movimentos.map((mov) => {
      const valorNum = Number(mov.valor);

      if (mov.status === 'CONCILIADO') {
        if (mov.natureza === 'RECEITA') {
          totalReceitas += valorNum;
        } else if (mov.natureza === 'DESPESA') {
          totalDespesasConsumo += valorNum;
        } else if (mov.natureza === 'TRANSFERENCIA_PROPRIA') {
          totalTransferenciasProprias += valorNum;
        } else if (mov.natureza === 'APORTE_PATRIMONIAL') {
          totalAportesPatrimoniais += valorNum;
        }
      }

      return {
        id: mov.id,
        contaId: mov.contaId,
        conta: mov.conta,
        categoriaId: mov.categoriaId,
        categoria: mov.categoria,
        dataMovimento: mov.dataMovimento.toISOString().split('T')[0],
        competencia: mov.competencia,
        descricao: mov.descricao,
        valor: valorNum,
        natureza: mov.natureza,
        status: mov.status,
        chaveDedupe: mov.chaveDedupe,
        transferenciaVinculoId: mov.transferenciaVinculoId,
        observacao: mov.observacao,
        origemDocumento: mov.origemDocumento,
        criadoEm: mov.criadoEm,
      };
    });

    return reply.status(200).send({
      resumo: {
        totalReceitas: Number(totalReceitas.toFixed(2)),
        totalDespesasConsumo: Number(totalDespesasConsumo.toFixed(2)),
        totalTransferenciasProprias: Number(totalTransferenciasProprias.toFixed(2)),
        totalAportesPatrimoniais: Number(totalAportesPatrimoniais.toFixed(2)),
        saldoOperacionalConsumo: Number((totalReceitas - totalDespesasConsumo).toFixed(2)),
      },
      movimentos: movimentosFormatados,
    });
  });

  // POST /api/movimentos (criação de movimento individual com regras anti-dupla contagem e transferências)
  app.post('/', async (request, reply) => {
    const usuarioId = request.user.sub;

    const parseResult = createMovimentoSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados inválidos para criação do movimento',
        issues: parseResult.error.issues,
      });
    }

    const data = parseResult.data;

    // 1. Validar propriedade da conta de origem
    const contaOrigem = await prisma.conta.findFirst({
      where: { id: data.contaId, usuarioId },
    });

    if (!contaOrigem) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Conta de origem não encontrada ou não pertence ao usuário.',
      });
    }

    // 2. Se informada categoria, validar existência e escopo
    if (data.categoriaId) {
      const categoria = await prisma.categoria.findFirst({
        where: {
          id: data.categoriaId,
          OR: [{ usuarioId: null }, { usuarioId }],
        },
      });

      if (!categoria) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Categoria não encontrada.',
        });
      }
    }

    // Competência default = YYYY-MM extraído da data do movimento
    const competenciaFinal = data.competencia || data.dataMovimento.substring(0, 7);
    const dataMovimentoDate = new Date(`${data.dataMovimento}T00:00:00.000Z`);

    // Geração de chave_dedupe se não informada
    const chaveDedupeCalculada =
      data.chaveDedupe ||
      gerarChaveDedupe({
        contaId: data.contaId,
        dataMovimento: data.dataMovimento,
        valor: data.valor,
        descricao: data.descricao,
      });

    // Verificação de deduplicação antes da inserção
    const movimentoDuplicado = await prisma.movimento.findFirst({
      where: {
        usuarioId,
        chaveDedupe: chaveDedupeCalculada,
      },
    });

    if (movimentoDuplicado) {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: 'Movimento duplicado detectado para a chave informada.',
        movimentoExistenteId: movimentoDuplicado.id,
      });
    }

    // Tratar Transferência Própria entre Contas ou Pagamento de Fatura de Cartão
    const isTransferencia =
      data.natureza === 'TRANSFERENCIA_PROPRIA' ||
      data.isPagamentoFatura ||
      Boolean(data.contaDestinoId);

    if (isTransferencia && data.contaDestinoId) {
      if (data.contaDestinoId === data.contaId) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Conta de origem e conta de destino não podem ser iguais para transferências.',
        });
      }

      const contaDestino = await prisma.conta.findFirst({
        where: { id: data.contaDestinoId, usuarioId },
      });

      if (!contaDestino) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Conta de destino não encontrada ou não pertence ao usuário.',
        });
      }

      // Regra de Anti-Dupla Contagem:
      // Se for pagamento de fatura ou transferência própria, natureza = TRANSFERENCIA_PROPRIA
      // Criação ATÔMICA das duas pernas do lançamento via transação Prisma
      const resultadoTransacao = await prisma.$transaction(async (tx) => {
        const descricaoOrigem = data.isPagamentoFatura
          ? `Pagamento Fatura Cartão: ${contaDestino.nome}`
          : `Transferência enviada para: ${contaDestino.nome} - ${data.descricao}`;

        const movSaida = await tx.movimento.create({
          data: {
            usuarioId,
            contaId: data.contaId,
            categoriaId: data.categoriaId ?? null,
            dataMovimento: dataMovimentoDate,
            competencia: competenciaFinal,
            descricao: descricaoOrigem,
            valor: data.valor,
            natureza: 'TRANSFERENCIA_PROPRIA',
            status: data.status,
            chaveDedupe: chaveDedupeCalculada,
            observacao: data.observacao,
            origemDocumento: data.origemDocumento,
          },
        });

        const descricaoDestino = data.isPagamentoFatura
          ? `Crédito Pagamento de Fatura (de ${contaOrigem.nome})`
          : `Transferência recebida de: ${contaOrigem.nome} - ${data.descricao}`;

        const chaveDedupeDestino = `${chaveDedupeCalculada}-contrapartida`;

        const movEntrada = await tx.movimento.create({
          data: {
            usuarioId,
            contaId: data.contaDestinoId!,
            categoriaId: data.categoriaId ?? null,
            dataMovimento: dataMovimentoDate,
            competencia: competenciaFinal,
            descricao: descricaoDestino,
            valor: data.valor,
            natureza: 'TRANSFERENCIA_PROPRIA',
            status: data.status,
            chaveDedupe: chaveDedupeDestino,
            transferenciaVinculoId: movSaida.id,
            observacao: data.observacao,
            origemDocumento: data.origemDocumento,
          },
        });

        // Atualizar vínculo no movimento de saída
        const movSaidaAtualizado = await tx.movimento.update({
          where: { id: movSaida.id },
          data: { transferenciaVinculoId: movEntrada.id },
        });

        return { movSaida: movSaidaAtualizado, movEntrada };
      });

      return reply.status(201).send({
        message: 'Transferência própria registrada com sucesso em ambas as contas.',
        movimento: {
          ...resultadoTransacao.movSaida,
          valor: Number(resultadoTransacao.movSaida.valor),
          dataMovimento: data.dataMovimento,
        },
        contrapartida: {
          ...resultadoTransacao.movEntrada,
          valor: Number(resultadoTransacao.movEntrada.valor),
          dataMovimento: data.dataMovimento,
        },
      });
    }

    // Regra Anti-Dupla Contagem para pagamento isolado de fatura informado sem contaDestino
    let naturezaFinal = data.natureza;
    if (data.isPagamentoFatura) {
      naturezaFinal = 'TRANSFERENCIA_PROPRIA';
    }

    const novoMovimento = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: data.contaId,
        categoriaId: data.categoriaId ?? null,
        dataMovimento: dataMovimentoDate,
        competencia: competenciaFinal,
        descricao: data.descricao,
        valor: data.valor,
        natureza: naturezaFinal,
        status: data.status,
        chaveDedupe: chaveDedupeCalculada,
        observacao: data.observacao,
        origemDocumento: data.origemDocumento,
      },
    });

    return reply.status(201).send({
      message: 'Movimento registrado com sucesso.',
      movimento: {
        ...novoMovimento,
        valor: Number(novoMovimento.valor),
        dataMovimento: data.dataMovimento,
      },
    });
  });

  // PUT /api/movimentos/:id (atualização de movimento)
  app.put('/:id', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params as { id: string };

    const movimentoExistente = await prisma.movimento.findFirst({
      where: { id, usuarioId },
    });

    if (!movimentoExistente) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Movimento não encontrado.',
      });
    }

    const parseResult = updateMovimentoSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados inválidos para atualização do movimento',
        issues: parseResult.error.issues,
      });
    }

    const data = parseResult.data;

    // Se atualizar conta, verificar existência
    if (data.contaId && data.contaId !== movimentoExistente.contaId) {
      const conta = await prisma.conta.findFirst({
        where: { id: data.contaId, usuarioId },
      });
      if (!conta) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Conta informada não encontrada.',
        });
      }
    }

    // Se atualizar categoria, verificar existência
    if (data.categoriaId) {
      const categoria = await prisma.categoria.findFirst({
        where: {
          id: data.categoriaId,
          OR: [{ usuarioId: null }, { usuarioId }],
        },
      });
      if (!categoria) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Categoria informada não encontrada.',
        });
      }
    }

    // Se atualizar chave dedupe, verificar se não colide
    if (data.chaveDedupe && data.chaveDedupe !== movimentoExistente.chaveDedupe) {
      const colidiu = await prisma.movimento.findFirst({
        where: {
          usuarioId,
          chaveDedupe: data.chaveDedupe,
          id: { not: id },
        },
      });
      if (colidiu) {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'Chave dedupe já existente em outro movimento.',
        });
      }
    }

    let dataMovimentoDate: Date | undefined;
    let competenciaCalculada: string | undefined = data.competencia;

    if (data.dataMovimento) {
      dataMovimentoDate = new Date(`${data.dataMovimento}T00:00:00.000Z`);
      if (!competenciaCalculada) {
        competenciaCalculada = data.dataMovimento.substring(0, 7);
      }
    }

    const movimentoAtualizado = await prisma.movimento.update({
      where: { id },
      data: {
        ...(data.contaId && { contaId: data.contaId }),
        ...(data.categoriaId !== undefined && { categoriaId: data.categoriaId }),
        ...(dataMovimentoDate && { dataMovimento: dataMovimentoDate }),
        ...(competenciaCalculada && { competencia: competenciaCalculada }),
        ...(data.descricao && { descricao: data.descricao }),
        ...(data.valor !== undefined && { valor: data.valor }),
        ...(data.natureza && { natureza: data.natureza }),
        ...(data.status && { status: data.status }),
        ...(data.chaveDedupe !== undefined && { chaveDedupe: data.chaveDedupe }),
        ...(data.observacao !== undefined && { observacao: data.observacao }),
        ...(data.origemDocumento !== undefined && { origemDocumento: data.origemDocumento }),
      },
    });

    return reply.status(200).send({
      message: 'Movimento atualizado com sucesso.',
      movimento: {
        ...movimentoAtualizado,
        valor: Number(movimentoAtualizado.valor),
        dataMovimento: movimentoAtualizado.dataMovimento.toISOString().split('T')[0],
      },
    });
  });

  // DELETE /api/movimentos/:id (remoção com tratamento de contrapartida de transferência)
  app.delete('/:id', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params as { id: string };

    const movimento = await prisma.movimento.findFirst({
      where: { id, usuarioId },
    });

    if (!movimento) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Movimento não encontrado.',
      });
    }

    // Se o movimento possuir um vínculo de transferência, remover ambos atomicamente
    if (movimento.transferenciaVinculoId) {
      const contrapartidaId = movimento.transferenciaVinculoId;
      await prisma.$transaction(async (tx) => {
        // Desvincular para evitar restrições de chave estrangeira antes de deletar
        await tx.movimento.updateMany({
          where: { id: { in: [id, contrapartidaId] } },
          data: { transferenciaVinculoId: null },
        });
        await tx.movimento.deleteMany({
          where: { id: { in: [id, contrapartidaId] }, usuarioId },
        });
      });

      return reply.status(200).send({
        message: 'Movimento e contrapartida de transferência removidos com sucesso.',
        id,
        contrapartidaId,
      });
    }

    await prisma.movimento.delete({
      where: { id },
    });

    return reply.status(200).send({
      message: 'Movimento removido com sucesso.',
      id,
    });
  });

  // POST /api/movimentos/importar (importação em lote com deduplicação)
  app.post('/importar', async (request, reply) => {
    const usuarioId = request.user.sub;

    const parseResult = importarMovimentosSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Lote de importação inválido',
        issues: parseResult.error.issues,
      });
    }

    const { origemDocumento, movimentos } = parseResult.data;

    let inseridos = 0;
    let ignoradosPorDedupe = 0;
    const erros: Array<{ index: number; motivo: string }> = [];

    for (let i = 0; i < movimentos.length; i++) {
      const item = movimentos[i];

      // Validar conta
      const conta = await prisma.conta.findFirst({
        where: { id: item.contaId, usuarioId },
      });

      if (!conta) {
        erros.push({ index: i, motivo: `Conta ${item.contaId} não encontrada para o usuário.` });
        continue;
      }

      const chave =
        item.chaveDedupe ||
        gerarChaveDedupe({
          contaId: item.contaId,
          dataMovimento: item.dataMovimento,
          valor: item.valor,
          descricao: item.descricao,
        });

      // Checagem se já existe
      const existente = await prisma.movimento.findFirst({
        where: { usuarioId, chaveDedupe: chave },
      });

      if (existente) {
        ignoradosPorDedupe++;
        continue;
      }

      // Regra Anti-Dupla Contagem para pagamento de fatura no lote
      let naturezaFinal = item.natureza;
      if (item.isPagamentoFatura) {
        naturezaFinal = 'TRANSFERENCIA_PROPRIA';
      }

      const competenciaFinal = item.competencia || item.dataMovimento.substring(0, 7);
      const dataMovimentoDate = new Date(`${item.dataMovimento}T00:00:00.000Z`);

      await prisma.movimento.create({
        data: {
          usuarioId,
          contaId: item.contaId,
          categoriaId: item.categoriaId ?? null,
          dataMovimento: dataMovimentoDate,
          competencia: competenciaFinal,
          descricao: item.descricao,
          valor: item.valor,
          natureza: naturezaFinal,
          status: item.status,
          chaveDedupe: chave,
          observacao: item.observacao,
          origemDocumento: item.origemDocumento || origemDocumento,
        },
      });

      inseridos++;
    }

    return reply.status(200).send({
      message: 'Importação processada com sucesso.',
      resumo: {
        totalProcessado: movimentos.length,
        inseridos,
        ignoradosPorDedupe,
        errosCount: erros.length,
      },
      erros,
    });
  });
};
