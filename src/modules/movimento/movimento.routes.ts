import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ensureAuthenticated } from '../../middlewares/auth.middleware.js';
import {
  createMovimentoSchema,
  updateMovimentoSchema,
  queryMovimentosSchema,
  importarMovimentosSchema,
  splitMovimentoSchema,
  vereditoSuspeitaSchema,
} from './movimento.schema.js';
import {
  gerarChaveDedupe,
  extrairRaizComerciante,
  extrairInfoParcelamento,
  gerarRegexParcelasIrmas,
} from './movimento.util.js';
import { REGEX_APORTES_INVESTIMENTOS, MovimentoRecalculoService } from './movimento-recalculo.service.js';
import { classificadorCombinatorioService } from './classificador-combinatorio.service.js';
import { env } from '../../config/env.js';
import {
  ValidacaoDeduplicacaoService,
  saoMesmaInstituicaoOuEquivalente,
  saoDuplicatasSemanticas,
  saoDistintosPorIdentificador,
  calcularSimilaridadeTexto,
} from './validacao-deduplicacao.service.js';
import { SuspeitaMovimentoWorkerService } from './suspeita-movimento-worker.service.js';

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
        rateios: {
          include: {
            categoria: {
              select: {
                id: true,
                nome: true,
                categoriaPaiId: true,
              },
            },
          },
          orderBy: { criadoEm: 'asc' },
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

      if (mov.status === 'CONCILIADO' || mov.status === 'PREVISTO') {
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
        categoriaFixadaPeloUsuario: mov.categoriaFixadaPeloUsuario,
        validadoDedupe: mov.validadoDedupe,
        transferenciaVinculoId: mov.transferenciaVinculoId,
        observacao: mov.observacao,
        origemDocumento: mov.origemDocumento,
        criadoEm: mov.criadoEm,
        rateios: mov.rateios?.map((r) => ({
          id: r.id,
          categoriaId: r.categoriaId,
          categoria: r.categoria,
          valor: Number(r.valor),
          descricao: r.descricao,
        })) || [],
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
        idOrigem: data.idOrigem,
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

    try {
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
          idOrigem: data.idOrigem,
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
    } catch (err: any) {
      if (err?.code === 'P2002') {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'Movimento duplicado detectado para a chave informada.',
        });
      }
      throw err;
    }
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

    const deveFixarCategoria =
      data.categoriaFixadaPeloUsuario !== undefined
        ? data.categoriaFixadaPeloUsuario
        : data.categoriaId !== undefined;

    const movimentoAtualizado = await prisma.movimento.update({
      where: { id },
      data: {
        ...(data.contaId && { contaId: data.contaId }),
        ...(data.categoriaId !== undefined && { categoriaId: data.categoriaId }),
        ...(deveFixarCategoria !== undefined && { categoriaFixadaPeloUsuario: deveFixarCategoria }),
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

    let totalPropagados = 0;
    let termoVendedor: string | null = null;

    // Propagação de Categoria:
    // 1. Prioridade A: Se for compra parcelada (ex: "UP - Parcela 4/6"), propaga para as demais parcelas irmãs não fixadas da mesma conta e mesmo valor
    // 2. Prioridade B: Propagação tradicional por comerciante/vendedor quando solicitado
    const descricaoReferencia = data.descricao || movimentoExistente.descricao;
    const infoParcelamento = extrairInfoParcelamento(descricaoReferencia);

    if (infoParcelamento && data.categoriaId !== undefined) {
      const regexParcelas = gerarRegexParcelasIrmas(infoParcelamento);
      const candidatosParcelas = await prisma.movimento.findMany({
        where: {
          usuarioId,
          contaId: movimentoAtualizado.contaId,
          id: { not: id },
          categoriaFixadaPeloUsuario: false,
          valor: movimentoAtualizado.valor,
        },
        select: { id: true, descricao: true },
      });

      const idsParcelasIrmas = candidatosParcelas
        .filter((c) => regexParcelas.test(c.descricao))
        .map((c) => c.id);

      if (idsParcelasIrmas.length > 0) {
        const resParcelas = await prisma.movimento.updateMany({
          where: {
            id: { in: idsParcelasIrmas },
            usuarioId,
          },
          data: {
            categoriaId: data.categoriaId,
          },
        });
        totalPropagados += resParcelas.count;
        termoVendedor = `${infoParcelamento.prefixoBase} (Parcelamento ${infoParcelamento.totalParcelas}x)`;
      }
    }

    // Se o usuário solicitou propagação da categoria para o mesmo vendedor
    // TASK-43: Propaga apenas para lançamentos onde a categoria NÃO foi fixada manualmente pelo usuário
    if (data.propagarMesmoVendedor && data.categoriaId !== undefined) {
      const raiz = extrairRaizComerciante(descricaoReferencia);
      if (raiz && raiz.length >= 3) {
        if (!termoVendedor) termoVendedor = raiz;
        const resUpdateMany = await prisma.movimento.updateMany({
          where: {
            usuarioId,
            id: { not: id },
            categoriaFixadaPeloUsuario: false,
            descricao: { contains: raiz, mode: 'insensitive' },
          },
          data: {
            categoriaId: data.categoriaId,
          },
        });
        totalPropagados += resUpdateMany.count;

        // Memoriza o catálogo de vendedor para categoria somente se memorizarRegraVendedor !== false
        if (data.categoriaId && data.memorizarRegraVendedor !== false) {
          await prisma.regraVendedorCategoria.upsert({
            where: {
              usuarioId_termoVendedor: {
                usuarioId,
                termoVendedor: raiz,
              },
            },
            create: {
              usuarioId,
              termoVendedor: raiz,
              categoriaId: data.categoriaId,
              totalAplicacoes: 1,
            },
            update: {
              categoriaId: data.categoriaId,
              totalAplicacoes: { increment: 1 },
              atualizadoEm: new Date(),
            },
          });
        }
      }
    }

    return reply.status(200).send({
      message: totalPropagados > 0
        ? `Movimento atualizado e categoria propagada para mais ${totalPropagados} lançamento(s) de "${termoVendedor}".`
        : 'Movimento atualizado com sucesso.',
      totalPropagados,
      termoVendedor,
      movimento: {
        ...movimentoAtualizado,
        valor: Number(movimentoAtualizado.valor),
        dataMovimento: movimentoAtualizado.dataMovimento.toISOString().split('T')[0],
      },
    });
  });

  // GET /api/movimentos/:id/similares-vendedor (retorna quantidade e termo raiz de outros movimentos do mesmo vendedor ou parcelamento)
  app.get('/:id/similares-vendedor', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params as { id: string };

    const movimento = await prisma.movimento.findFirst({
      where: { id, usuarioId },
      select: { id: true, descricao: true, categoriaId: true, contaId: true, valor: true },
    });

    if (!movimento) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Movimento não encontrado.',
      });
    }

    // Verifica se é parcelamento
    const infoParcelamento = extrairInfoParcelamento(movimento.descricao);
    if (infoParcelamento) {
      const regexParcelas = gerarRegexParcelasIrmas(infoParcelamento);
      const candidatosParcelas = await prisma.movimento.findMany({
        where: {
          usuarioId,
          contaId: movimento.contaId,
          id: { not: id },
          categoriaFixadaPeloUsuario: false,
          valor: movimento.valor,
        },
        select: { id: true, descricao: true },
      });

      const totalSimilares = candidatosParcelas.filter((c) => regexParcelas.test(c.descricao)).length;
      if (totalSimilares > 0) {
        return reply.status(200).send({
          termoVendedor: `${infoParcelamento.prefixoBase} (Parcelamento ${infoParcelamento.totalParcelas}x)`,
          totalSimilares,
        });
      }
    }

    const raiz = extrairRaizComerciante(movimento.descricao);
    if (!raiz || raiz.length < 3) {
      return reply.status(200).send({
        termoVendedor: null,
        totalSimilares: 0,
      });
    }

    const totalSimilares = await prisma.movimento.count({
      where: {
        usuarioId,
        id: { not: id },
        categoriaFixadaPeloUsuario: false,
        descricao: { contains: raiz, mode: 'insensitive' },
      },
    });

    return reply.status(200).send({
      termoVendedor: raiz,
      totalSimilares,
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

    // Se for um pagamento de fatura vinculado a ArquivoImportacao, desvincular antes de deletar
    await prisma.arquivoImportacao.updateMany({
      where: { faturaPagamentoMovimentoId: id },
      data: { faturaPagamentoMovimentoId: null },
    });

    // Se o movimento for uma projeção de parcelamento ou tiver vínculo com parcelamento ativo
    const isProjecao = movimento.origemDocumento === 'PROJECAO_PARCELAMENTO' || movimento.status === 'PREVISTO';
    const infoParc = extrairInfoParcelamento(movimento.descricao);
    let parcelamentoAfetadoId: string | null = null;

    if (isProjecao || infoParc) {
      const baseBusca = (infoParc?.prefixoBase || movimento.descricao).trim();
      const parcelamentoVinculado = await prisma.parcelamento.findFirst({
        where: {
          usuarioId,
          contaId: movimento.contaId,
          status: 'ATIVO',
          OR: [
            { descricao: { contains: baseBusca, mode: 'insensitive' } },
            ...(infoParc ? [{ totalParcelas: infoParc.totalParcelas }] : []),
          ],
        },
      });

      if (parcelamentoVinculado) {
        // Se a parcela atual for menor ou igual à excluída, ou se for cancelamento de projeção futura
        parcelamentoAfetadoId = parcelamentoVinculado.id;
        // Se o usuário está excluindo um lançamento previsto/futuro do contrato, cancelar o contrato e remover demais projeções
        if (isProjecao) {
          await prisma.$transaction(async (tx) => {
            // Cancela o parcelamento para impedir que o worker regenere as parcelas excluídas
            await tx.parcelamento.update({
              where: { id: parcelamentoVinculado.id },
              data: { status: 'CANCELADO' },
            });

            // Remove todos os movimentos futuros projetados (PREVISTO) deste contrato
            await tx.movimento.deleteMany({
              where: {
                usuarioId,
                contaId: parcelamentoVinculado.contaId || undefined,
                status: 'PREVISTO',
                origemDocumento: 'PROJECAO_PARCELAMENTO',
                descricao: { contains: baseBusca, mode: 'insensitive' },
              },
            });
          });

          return reply.status(200).send({
            message: 'Lançamento projetado e contrato de parcelamento cancelados com sucesso.',
            id,
            parcelamentoId: parcelamentoAfetadoId,
          });
        }
      }
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

  // POST /api/movimentos/:id/split (desdobramento analítico de categorias)
  app.post('/:id/split', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params as { id: string };

    const parseResult = splitMovimentoSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados de desdobramento inválidos.',
        issues: parseResult.error.issues,
      });
    }

    const { splits } = parseResult.data;

    // Buscar movimento isolado pelo usuarioId
    const movimento = await prisma.movimento.findFirst({
      where: { id, usuarioId },
    });

    if (!movimento) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Movimento não encontrado para desdobramento.',
      });
    }

    // Validar rigorosamente se a soma dos splits bate com o valor do movimento
    const valorOriginal = Number(movimento.valor);
    const somaSplits = Number(splits.reduce((acc, s) => acc + s.valor, 0).toFixed(2));

    if (Math.abs(somaSplits - valorOriginal) > 0.001) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `A soma dos valores dos desdobramentos (R$ ${somaSplits.toFixed(2)}) deve ser estritamente igual ao valor do lançamento original (R$ ${valorOriginal.toFixed(2)}).`,
      });
    }

    // Validar se todas as categorias existem e pertencem ao usuário ou ao sistema (usuarioId: null)
    const categoriaIds = splits.map((s) => s.categoriaId);
    const categoriasValidas = await prisma.categoria.findMany({
      where: {
        id: { in: categoriaIds },
        OR: [{ usuarioId: null }, { usuarioId }],
      },
    });

    if (categoriasValidas.length !== new Set(categoriaIds).size) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Uma ou mais categorias informadas são inválidas ou não pertencem ao usuário.',
      });
    }

    // Executar substituição atômica dos splits na transação
    const rateiosSalvos = await prisma.$transaction(async (tx) => {
      // Remove rateios anteriores se existirem
      await tx.movimentoRateio.deleteMany({
        where: { movimentoId: id },
      });

      // Cria novos rateios
      const criados = [];
      for (const s of splits) {
        const item = await tx.movimentoRateio.create({
          data: {
            movimentoId: id,
            categoriaId: s.categoriaId,
            valor: s.valor,
            descricao: s.descricao || null,
          },
          include: {
            categoria: {
              select: {
                id: true,
                nome: true,
                categoriaPaiId: true,
              },
            },
          },
        });
        criados.push(item);
      }

      return criados;
    });

    return reply.status(200).send({
      sucesso: true,
      message: `Lançamento desdobrado com sucesso em ${rateiosSalvos.length} categorias.`,
      movimentoId: id,
      rateios: rateiosSalvos.map((r) => ({
        id: r.id,
        categoriaId: r.categoriaId,
        categoria: r.categoria,
        valor: Number(r.valor),
        descricao: r.descricao,
      })),
    });
  });

  // DELETE /api/movimentos/:id/split (reversão do desdobramento)
  app.delete('/:id/split', async (request, reply) => {
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

    const { count } = await prisma.movimentoRateio.deleteMany({
      where: { movimentoId: id },
    });

    return reply.status(200).send({
      sucesso: true,
      message: `Desdobramento revertido com sucesso. ${count} fatia(s) removida(s).`,
      movimentoId: id,
    });
  });

  // TASK-45: GET /api/movimentos/suspeitas (Central de Validação de Suspeitas do Usuário - Consulta Direta à Tabela via JOIN)
  app.get('/suspeitas', async (request, reply) => {
    const usuarioId = request.user.sub;

    const queryParams = request.query as { similaridadeMinima?: string } | undefined;
    const thresholdQuery = queryParams?.similaridadeMinima !== undefined ? Number(queryParams.similaridadeMinima) : NaN;
    const similaridadeMinima = !isNaN(thresholdQuery) && thresholdQuery >= 0 && thresholdQuery <= 1
      ? thresholdQuery
      : undefined;

    // Se o usuário passar similaridadeMinima específica via query param, re-cataloga sob demanda
    if (similaridadeMinima !== undefined) {
      await SuspeitaMovimentoWorkerService.catalogarSuspeitasParaUsuario(usuarioId, {
        similaridadeMinima,
      });
    } else {
      // Se a tabela ainda não tiver nenhuma suspeita pendente para o usuário, executa a catalogação como garantia inicial
      const totalGravadas = await prisma.suspeitaMovimento.count({
        where: { usuarioId, status: 'PENDENTE' },
      });

      if (totalGravadas === 0) {
        await SuspeitaMovimentoWorkerService.catalogarSuspeitasParaUsuario(usuarioId);
      }
    }

    // Consulta direta (CRUD SELECT com JOIN) na tabela suspeitas_movimento
    const registrosSuspeita = await prisma.suspeitaMovimento.findMany({
      where: {
        usuarioId,
        status: 'PENDENTE',
      },
      include: {
        movimento: {
          include: {
            conta: {
              select: { id: true, nome: true, tipo: true },
            },
            categoria: {
              select: { id: true, nome: true, categoriaPaiId: true },
            },
          },
        },
        movimentoSecundario: {
          include: {
            conta: {
              select: { id: true, nome: true, tipo: true },
            },
            categoria: {
              select: { id: true, nome: true, categoriaPaiId: true },
            },
          },
        },
      },
      orderBy: { criadoEm: 'desc' },
    });

    const suspeitasDuplicatas: Array<{
      id: string;
      tipo: 'SUSPEITA_DUPLICATA';
      confianca: number;
      motivo: string;
      movimentoA: any;
      movimentoB: any;
    }> = [];

    const suspeitasAportes: Array<{
      id: string;
      tipo: 'SUSPEITA_APORTE';
      confianca: number;
      motivo: string;
      movimento: any;
      sugestaoNatureza: 'APORTE_PATRIMONIAL';
    }> = [];

    const suspeitasCategorizacao: Array<{
      id: string;
      tipo: 'SUSPEITA_CATEGORIZACAO';
      confianca: number;
      motivo: string;
      movimento: any;
      categoriaSugerida?: string;
      termoVendedor?: string;
      regraVendedorSalva?: {
        categoriaId: string;
        categoriaNome: string;
        categoriaPaiNome: string | null;
        totalAplicacoes: number;
      };
      totalSimilaresVendedor?: number;
    }> = [];

    for (const s of registrosSuspeita) {
      const confiancaNum = Number(s.confianca);

      if (s.tipo === 'SUSPEITA_DUPLICATA' && s.movimento && s.movimentoSecundario) {
        const mA = s.movimento;
        const mB = s.movimentoSecundario;
        const dataA = mA.dataMovimento.toISOString().slice(0, 10);
        const dataB = mB.dataMovimento.toISOString().slice(0, 10);

        suspeitasDuplicatas.push({
          id: s.id,
          tipo: 'SUSPEITA_DUPLICATA',
          confianca: confiancaNum,
          motivo: s.motivo,
          movimentoA: {
            ...mA,
            idOrigem: mA.idOrigem || null,
            valor: Number(mA.valor),
            dataMovimento: dataA,
          },
          movimentoB: {
            ...mB,
            idOrigem: mB.idOrigem || null,
            valor: Number(mB.valor),
            dataMovimento: dataB,
          },
        });
      } else if (s.tipo === 'SUSPEITA_APORTE' && s.movimento) {
        const m = s.movimento;
        suspeitasAportes.push({
          id: s.id,
          tipo: 'SUSPEITA_APORTE',
          confianca: confiancaNum,
          motivo: s.motivo,
          movimento: {
            ...m,
            valor: Number(m.valor),
            dataMovimento: m.dataMovimento.toISOString().slice(0, 10),
          },
          sugestaoNatureza: 'APORTE_PATRIMONIAL',
        });
      } else if (s.tipo === 'SUSPEITA_CATEGORIZACAO' && s.movimento) {
        const m = s.movimento;
        const raiz = extrairRaizComerciante(m.descricao);

        let regraVendedorSalva: {
          categoriaId: string;
          categoriaNome: string;
          categoriaPaiNome: string | null;
          totalAplicacoes: number;
        } | null = null;
        let totalSimilaresVendedor = 0;

        if (raiz && raiz.length >= 3) {
          const regra = await prisma.regraVendedorCategoria.findFirst({
            where: {
              usuarioId,
              termoVendedor: { equals: raiz, mode: 'insensitive' },
            },
            include: {
              categoria: {
                select: {
                  id: true,
                  nome: true,
                  categoriaPai: { select: { nome: true } },
                },
              },
            },
          });
          if (regra) {
            regraVendedorSalva = {
              categoriaId: regra.categoria.id,
              categoriaNome: regra.categoria.nome,
              categoriaPaiNome: regra.categoria.categoriaPai?.nome || null,
              totalAplicacoes: regra.totalAplicacoes,
            };
          }

          totalSimilaresVendedor = await prisma.movimento.count({
            where: {
              usuarioId,
              id: { not: m.id },
              categoriaFixadaPeloUsuario: false,
              descricao: { contains: raiz, mode: 'insensitive' },
            },
          });
        }

        suspeitasCategorizacao.push({
          id: s.id,
          tipo: 'SUSPEITA_CATEGORIZACAO',
          confianca: confiancaNum,
          motivo: s.motivo,
          movimento: {
            ...m,
            valor: Number(m.valor),
            dataMovimento: m.dataMovimento.toISOString().slice(0, 10),
          },
          categoriaSugerida: s.categoriaSugerida || undefined,
          termoVendedor: raiz || m.descricao,
          regraVendedorSalva: regraVendedorSalva || undefined,
          totalSimilaresVendedor,
        });
      }
    }

    const totalPendentes =
      suspeitasDuplicatas.length + suspeitasAportes.length + suspeitasCategorizacao.length;

    return reply.status(200).send({
      totalPendentes,
      suspeitasDuplicatas,
      suspeitasAportes,
      suspeitasCategorizacao,
    });
  });

  // TASK-45: POST /api/movimentos/suspeitas/:id/veredito (Aplicação Soberana de Veredito pelo Usuário)
  app.post('/suspeitas/:id/veredito', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params as { id: string };

    const parseResult = vereditoSuspeitaSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados de veredito inválidos',
        issues: parseResult.error.issues,
      });
    }

    const { acao, duplicataId, categoriaId, observacao } = parseResult.data;

    // O identificador pode ser o ID do movimento ou o ID do registro na tabela suspeitas_movimento
    let movimentoAlvoId = id;
    const registroSuspeitaPorId = await prisma.suspeitaMovimento.findFirst({
      where: { id, usuarioId },
    });
    if (registroSuspeitaPorId) {
      movimentoAlvoId = registroSuspeitaPorId.movimentoId;
    }

    // Busca o movimento principal garantindo isolamento multi-tenant
    const movimentoPrincipal = await prisma.movimento.findFirst({
      where: { id: movimentoAlvoId, usuarioId },
    });

    if (!movimentoPrincipal) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Movimento alvo não encontrado.',
      });
    }

    // Função auxiliar para marcar a suspeita como resolvida na tabela suspeitas_movimento
    const marcarSuspeitaResolvida = async (txPrisma: any) => {
      const idsMovimentosEnvolvidos = [movimentoAlvoId];
      if (duplicataId) idsMovimentosEnvolvidos.push(duplicataId);

      await txPrisma.suspeitaMovimento.updateMany({
        where: {
          usuarioId,
          status: 'PENDENTE',
          OR: [
            { id },
            { movimentoId: { in: idsMovimentosEnvolvidos } },
            { movimentoSecundarioId: { in: idsMovimentosEnvolvidos } },
          ],
        },
        data: {
          status: 'RESOLVIDO',
          acaoAplicada: acao,
          resolvidoEm: new Date(),
        },
      });
    };

    switch (acao) {
      case 'CONFIRMAR_DUPLICATA_DESCARTAR': {
        // O usuário decide que um dos dois é duplicata.
        // Se duplicataId for fornecido, descarta o duplicataId e preserva o principal.
        // Caso contrário, descarta o id principal.
        const idParaDescartar = duplicataId || movimentoAlvoId;
        const idParaPreservar = idParaDescartar === movimentoAlvoId ? duplicataId : movimentoAlvoId;

        await prisma.$transaction(async (tx) => {
          // Desconecta vínculos de transferência se houver
          const movDescarte = await tx.movimento.findFirst({
            where: { id: idParaDescartar, usuarioId },
          });

          if (movDescarte?.transferenciaVinculoId) {
            await tx.movimento.updateMany({
              where: { id: { in: [movDescarte.id, movDescarte.transferenciaVinculoId] } },
              data: { transferenciaVinculoId: null },
            });
          }

          if (movDescarte) {
            await tx.movimento.delete({
              where: { id: idParaDescartar },
            });
          }

          // Se houver registro preservado, imuniza soberanamente
          if (idParaPreservar) {
            const movPreservado = await tx.movimento.findFirst({
              where: { id: idParaPreservar, usuarioId },
            });

            if (movPreservado) {
              await tx.movimento.update({
                where: { id: idParaPreservar },
                data: {
                  validadoDedupe: 'S',
                  categoriaFixadaPeloUsuario: true,
                  ...(observacao && { observacao }),
                },
              });
            }
          }

          await marcarSuspeitaResolvida(tx);
        });

        return reply.status(200).send({
          sucesso: true,
          message: 'Duplicata descartada com sucesso. Registro remanescente imunizado contra reprocessamentos.',
          acaoAplicada: acao,
          descartadoId: idParaDescartar,
          preservadoId: idParaPreservar,
        });
      }

      case 'CONFIRMAR_DISTINTOS_PRESERVAR': {
        // Usuário atesta que são duas compras distintas e legítimas
        await prisma.$transaction(async (tx) => {
          await tx.movimento.update({
            where: { id: movimentoAlvoId },
            data: {
              validadoDedupe: 'S',
              categoriaFixadaPeloUsuario: true,
              ...(observacao && { observacao }),
            },
          });

          if (duplicataId) {
            await tx.movimento.update({
              where: { id: duplicataId },
              data: {
                validadoDedupe: 'S',
                categoriaFixadaPeloUsuario: true,
              },
            });
          }

          await marcarSuspeitaResolvida(tx);
        });

        return reply.status(200).send({
          sucesso: true,
          message: 'Ambos os lançamentos foram confirmados como válidos e blindados contra remoção.',
          acaoAplicada: acao,
        });
      }

      case 'CONVERTER_APORTE_PATRIMONIAL': {
        // Usuário confirma que o lançamento é aporte financeiro / investimento
        await prisma.$transaction(async (tx) => {
          await tx.movimento.update({
            where: { id: movimentoAlvoId },
            data: {
              natureza: 'APORTE_PATRIMONIAL',
              validadoDedupe: 'S',
              categoriaFixadaPeloUsuario: true,
              ...(categoriaId && { categoriaId }),
              ...(observacao && { observacao }),
            },
          });

          await marcarSuspeitaResolvida(tx);
        });

        return reply.status(200).send({
          sucesso: true,
          message: 'Lançamento convertido em Aporte Patrimonial e isolado do cômputo de despesas.',
          acaoAplicada: acao,
        });
      }

      case 'CONVERTER_TRANSFERENCIA_PROPRIA': {
        // Usuário confirma que os lançamentos são transferência própria entre contas da mesma titularidade
        await prisma.$transaction(async (tx) => {
          await tx.movimento.update({
            where: { id: movimentoAlvoId },
            data: {
              natureza: 'TRANSFERENCIA_PROPRIA',
              validadoDedupe: 'S',
              categoriaFixadaPeloUsuario: true,
              ...(observacao && { observacao }),
            },
          });

          if (duplicataId) {
            // Se foi fornecido o par da transferência, converte e vincula ambos
            await tx.movimento.update({
              where: { id: duplicataId },
              data: {
                natureza: 'TRANSFERENCIA_PROPRIA',
                validadoDedupe: 'S',
                categoriaFixadaPeloUsuario: true,
                transferenciaVinculoId: movimentoAlvoId,
              },
            });

            await tx.movimento.update({
              where: { id: movimentoAlvoId },
              data: {
                transferenciaVinculoId: duplicataId,
              },
            });
          }

          await marcarSuspeitaResolvida(tx);
        });

        return reply.status(200).send({
          sucesso: true,
          message: 'Lançamento reconhecido como transferência própria / pagamento de fatura (não afeta despesas nem receitas).',
          acaoAplicada: acao,
        });
      }

      case 'CONFIRMAR_DESPESA_REGULAR': {
        // Usuário confirma que é despesa comum de consumo, não aporte
        await prisma.$transaction(async (tx) => {
          await tx.movimento.update({
            where: { id: movimentoAlvoId },
            data: {
              natureza: 'DESPESA',
              validadoDedupe: 'S',
              categoriaFixadaPeloUsuario: true,
              ...(observacao && { observacao }),
            },
          });

          await marcarSuspeitaResolvida(tx);
        });

        return reply.status(200).send({
          sucesso: true,
          message: 'Lançamento confirmado como despesa regular e imunizado.',
          acaoAplicada: acao,
        });
      }

      case 'DEFINIR_CATEGORIA': {
        if (!categoriaId) {
          return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'categoriaId é obrigatório para a ação DEFINIR_CATEGORIA.',
          });
        }

        let parcelasPropagadas = 0;
        let vendedorPropagados = 0;
        let termoVendedorIdentificado: string | null = null;
        let regraMemorizada = false;

        const { propagarMesmoVendedor, memorizarRegraVendedor } = parseResult.data;
        const raizVendedor = extrairRaizComerciante(movimentoPrincipal.descricao);

        await prisma.$transaction(async (tx) => {
          await tx.movimento.update({
            where: { id: movimentoAlvoId },
            data: {
              categoriaId,
              categoriaFixadaPeloUsuario: true,
              validadoDedupe: 'S',
              ...(observacao && { observacao }),
            },
          });

          await marcarSuspeitaResolvida(tx);

          // 1. Memorizar regra de vendedor se solicitado expressamente pelo usuário
          if (memorizarRegraVendedor && raizVendedor && raizVendedor.length >= 3) {
            termoVendedorIdentificado = raizVendedor;
            await tx.regraVendedorCategoria.upsert({
              where: {
                usuarioId_termoVendedor: {
                  usuarioId,
                  termoVendedor: raizVendedor,
                },
              },
              create: {
                usuarioId,
                termoVendedor: raizVendedor,
                categoriaId,
                totalAplicacoes: 1,
              },
              update: {
                categoriaId,
                totalAplicacoes: { increment: 1 },
                atualizadoEm: new Date(),
              },
            });
            regraMemorizada = true;
          }

          // 2. Se o lançamento pertencer a um parcelamento (ex: "UP - Parcela 4/6"),
          // propaga automaticamente a categoria para as outras parcelas da mesma compra
          const infoParcelamento = extrairInfoParcelamento(movimentoPrincipal.descricao);
          if (infoParcelamento) {
            const regexParcelas = gerarRegexParcelasIrmas(infoParcelamento);
            const candidatosParcelas = await tx.movimento.findMany({
              where: {
                usuarioId,
                contaId: movimentoPrincipal.contaId,
                id: { not: movimentoAlvoId },
                categoriaFixadaPeloUsuario: false,
                valor: movimentoPrincipal.valor,
              },
              select: { id: true, descricao: true },
            });

            const idsParcelasIrmas = candidatosParcelas
              .filter((c) => regexParcelas.test(c.descricao))
              .map((c) => c.id);

            if (idsParcelasIrmas.length > 0) {
              const resUpdate = await tx.movimento.updateMany({
                where: {
                  id: { in: idsParcelasIrmas },
                  usuarioId,
                },
                data: {
                  categoriaId,
                  categoriaFixadaPeloUsuario: true,
                  validadoDedupe: 'S',
                },
              });

              parcelasPropagadas = resUpdate.count;

              // Também resolve quaisquer suspeitas pendentes associadas a essas parcelas irmãs
              await tx.suspeitaMovimento.updateMany({
                where: {
                  usuarioId,
                  status: 'PENDENTE',
                  movimentoId: { in: idsParcelasIrmas },
                },
                data: {
                  status: 'RESOLVIDO',
                  acaoAplicada: 'DEFINIR_CATEGORIA',
                  resolvidoEm: new Date(),
                },
              });
            }
          }

          // 3. Se solicitada propagação para outros lançamentos do mesmo estabelecimento/vendedor
          if (propagarMesmoVendedor && raizVendedor && raizVendedor.length >= 3) {
            termoVendedorIdentificado = raizVendedor;
            const candidatosVendedor = await tx.movimento.findMany({
              where: {
                usuarioId,
                id: { not: movimentoAlvoId },
                categoriaFixadaPeloUsuario: false,
                descricao: { contains: raizVendedor, mode: 'insensitive' },
              },
              select: { id: true },
            });

            const idsVendedor = candidatosVendedor.map((c) => c.id);
            if (idsVendedor.length > 0) {
              const resVendedor = await tx.movimento.updateMany({
                where: {
                  id: { in: idsVendedor },
                  usuarioId,
                },
                data: {
                  categoriaId,
                  categoriaFixadaPeloUsuario: true,
                  validadoDedupe: 'S',
                },
              });

              vendedorPropagados = resVendedor.count;

              // Também resolve suspeitas de categorização pendentes desses mesmos lançamentos
              await tx.suspeitaMovimento.updateMany({
                where: {
                  usuarioId,
                  status: 'PENDENTE',
                  movimentoId: { in: idsVendedor },
                },
                data: {
                  status: 'RESOLVIDO',
                  acaoAplicada: 'DEFINIR_CATEGORIA',
                  resolvidoEm: new Date(),
                },
              });
            }
          }
        });

        let msgSucesso = 'Categoria definida e fixada com sucesso pelo usuário.';
        if (vendedorPropagados > 0 && parcelasPropagadas > 0) {
          msgSucesso = `Categoria definida e replicada para ${vendedorPropagados} lançamento(s) de "${termoVendedorIdentificado}" e ${parcelasPropagadas} parcela(s) correlatas.`;
        } else if (vendedorPropagados > 0) {
          msgSucesso = `Categoria definida com sucesso e replicada para mais ${vendedorPropagados} lançamento(s) de "${termoVendedorIdentificado}".`;
        } else if (parcelasPropagadas > 0) {
          msgSucesso = `Categoria definida com sucesso e replicada para as demais ${parcelasPropagadas} parcelas do lançamento.`;
        } else if (regraMemorizada) {
          msgSucesso = `Categoria definida e regra memorizada para compras futuras em "${termoVendedorIdentificado}".`;
        }

        return reply.status(200).send({
          sucesso: true,
          message: msgSucesso,
          acaoAplicada: acao,
          parcelasPropagadas,
          vendedorPropagados,
          termoVendedor: termoVendedorIdentificado,
          regraMemorizada,
        });
      }

      default:
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `Ação desconhecida: ${acao}`,
        });
    }
  });

  // POST /api/movimentos/suspeitas/reprocessar (Reprocessamento imediato da malha fina e recálculo para o usuário)
  app.post('/suspeitas/reprocessar', async (request, reply) => {
    const usuarioId = request.user.sub;

    const recalculo = await MovimentoRecalculoService.verificarERecalcularSeNecessario(usuarioId, true);
    const resultadoDeduplicacao = await ValidacaoDeduplicacaoService.executarMalhaFinaParaUsuario(usuarioId, {
      reprocessarTudo: true,
    });
    const catalogacaoSuspeitas = await SuspeitaMovimentoWorkerService.catalogarSuspeitasParaUsuario(usuarioId);

    return reply.status(200).send({
      sucesso: true,
      message: 'Reprocessamento, malha fina e catalogação de suspeitas executados com sucesso.',
      recalculo,
      resultadoDeduplicacao,
      catalogacaoSuspeitas,
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
          idOrigem: item.idOrigem,
        });

      // Checagem se já existe
      const existente = await prisma.movimento.findFirst({
        where: { usuarioId, chaveDedupe: chave },
      });

      if (existente) {
        ignoradosPorDedupe++;
        continue;
      }

      // Regra Anti-Dupla Contagem e Prevalência de Proventos/Salário/PLR
      let naturezaFinal = item.natureza;
      const isSalarioOuPlr =
        /ted\s*conta\s*sal[aá]rio|cred\s*(ted\s*)?sal[aá]rio|folha\s*pag(amento)?|remunera[cç][aã]o|pagamento\s*de\s*sal[aá]rio|(?:\b|^)plr(?:\b|$)|participa[cç][aã]o\s*lucros|b[oô]nus\s*salarial|abono\s*salarial|13[oº]?\s*sal[aá]rio|sal[aá]rio\s*mensal/i.test(
          item.descricao
        );

      if (isSalarioOuPlr) {
        naturezaFinal = 'RECEITA';
      } else if (
        /aplica[cç][aã]o\s*(de)?\s*(cdb|rdb|lci|lca|tesouro|fundo|investimento|financeira)?|(?:\b|^)(cdb|rdb|lci|lca)(?:\b|$)|tesouro\s*direto|dep[oó]sito\s*poupan[cç]a|compra\s*a[cç][oõ]es|(?:\b|^)investimento(?:\b|$)/i.test(
          item.descricao
        )
      ) {
        naturezaFinal = 'APORTE_PATRIMONIAL';
      } else if (item.isPagamentoFatura) {
        naturezaFinal = 'TRANSFERENCIA_PROPRIA';
      }

      const competenciaFinal = item.competencia || item.dataMovimento.substring(0, 7);
      const dataMovimentoDate = new Date(`${item.dataMovimento}T00:00:00.000Z`);

      try {
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
            idOrigem: item.idOrigem,
            observacao: item.observacao,
            origemDocumento: item.origemDocumento || origemDocumento,
          },
        });

        inseridos++;
      } catch (err: any) {
        if (err?.code === 'P2002') {
          ignoradosPorDedupe++;
          continue;
        }
        throw err;
      }
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
