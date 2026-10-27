import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import { ensureAuthenticated } from '../../middlewares/auth.middleware.js';
import { ImportacaoStorageService, SalvarArquivoInput } from './importacao-storage.service.js';
import {
  queryLotesImportacaoSchema,
  loteIdParamSchema,
  processarLoteIaBodySchema,
  arquivoIdParamSchema,
  reprocessarArquivoIaBodySchema,
  uploadImportacaoQuerySchema,
  queryTentativasArquivoSchema,
} from './importacao.schema.js';
import { ImportacaoTentativasService } from './importacao-tentativas.service.js';

export const importacaoRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const storageService = new ImportacaoStorageService();

  // Registra suporte a multipart/form-data com limites generosos para pastas e faturas
  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB por arquivo individual
      files: 100, // até 100 arquivos simultâneos em lote
    },
  });

  // Todas as rotas de importação requerem autenticação
  app.register(async (authApp) => {
    authApp.addHook('preHandler', ensureAuthenticated);

    /**
     * POST /api/importacao/upload
     * Recepciona 1 arquivo, múltiplos arquivos ou pastas completas (multipart).
     * Salva no disco com o padrão {UPLOADS_DIR}/{usuarioId}/{yyyy-mm-dd-hh-mm-ss}-{usuarioId}/
     * e retorna HTTP 202 Accepted imediatamente com loteId.
     */
    authApp.post('/upload', async (request, reply) => {
      const usuarioId = request.user.sub;

      if (!request.isMultipart()) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'A requisição deve ser multipart/form-data contendo arquivos.',
        });
      }

      const queryParsed = uploadImportacaoQuerySchema.safeParse(request.query || {});
      const queryUpload = queryParsed.success ? queryParsed.data : { forcarReprocessamento: false };

      const files: SalvarArquivoInput[] = [];
      let provedorIa: string | undefined =
        queryUpload.provedorIa || (request.query as any)?.provedorIa;
      let modeloIa: string | undefined = queryUpload.modeloIa || (request.query as any)?.modeloIa;
      let forcarReprocessamento = Boolean(queryUpload.forcarReprocessamento);
      let origem: 'UPLOAD' | 'PASTA' | undefined = queryUpload.origem;
      const parts = request.parts();

      for await (const part of parts) {
        if (part.type === 'file') {
          const buffer = await part.toBuffer();
          // filename pode vir com caminho relativo se enviado via input com webkitdirectory
          const nomeOriginal = part.filename || `arquivo_${Date.now()}`;
          files.push({
            nomeOriginal,
            buffer,
            mimeType: part.mimetype,
          });
        } else if (part.type === 'field') {
          if (part.fieldname === 'provedorIa' && typeof part.value === 'string' && part.value.trim()) {
            provedorIa = part.value.trim();
          } else if (part.fieldname === 'modeloIa' && typeof part.value === 'string' && part.value.trim()) {
            modeloIa = part.value.trim();
          } else if (part.fieldname === 'origem' && typeof part.value === 'string' && part.value.trim()) {
            const valor = part.value.trim().toUpperCase();
            if (valor === 'UPLOAD' || valor === 'PASTA') origem = valor;
          } else if (
            part.fieldname === 'forcarReprocessamento' &&
            typeof part.value === 'string' &&
            part.value.trim()
          ) {
            forcarReprocessamento = ['true', '1', 'sim', 's'].includes(
              part.value.trim().toLowerCase()
            );
          }
        }
      }

      if (files.length === 0) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Nenhum arquivo encontrado no upload.',
        });
      }

      try {
        const resultado = await storageService.recepcionarLote({
          usuarioId,
          arquivos: files,
          provedorIa,
          modeloIa,
          forcarReprocessamento,
          origem,
        });

        // Bloqueante apenas quando a duplicidade ainda exige confirmação explícita.
        const temAlertaDuplicidade = resultado.requerConfirmacaoReprocessamento;

        // HTTP 202 Accepted para resposta imediata assíncrona.
        // TASK-50: quando há duplicidade não confirmada, retorna 409 Conflict com o
        // alerta e o parâmetro `forcarReprocessamento` para reprocessamento explícito.
        const mensagem = temAlertaDuplicidade
          ? `Atenção: ${resultado.alertasDuplicidade.length} arquivo(s) já importado(s) anteriormente. Confirme o reprocessamento para prosseguir.`
          : 'Arquivos recepcionados com sucesso na pasta temporária do servidor.';

        const resposta = {
          statusCode: temAlertaDuplicidade ? 409 : 202,
          message: mensagem,
          loteId: resultado.loteId,
          status: resultado.status,
          origem: resultado.origem,
          iaSelecionada: resultado.iaSelecionada,
          totalArquivos: resultado.totalArquivos,
          totalSucesso: resultado.totalSucesso,
          totalFalha: resultado.totalFalha,
          totalDuplicados: resultado.totalDuplicados,
          totalLancamentos: resultado.totalLancamentos,
          caminhoDiretorio: resultado.caminhoDiretorio,
          arquivos: resultado.arquivos,
          // TASK-50: alerta de duplicidade
          requerConfirmacaoReprocessamento: resultado.requerConfirmacaoReprocessamento,
          jaImportadoAnteriormente: resultado.requerConfirmacaoReprocessamento,
          alertasDuplicidade: resultado.alertasDuplicidade,
          duplicados: resultado.alertasDuplicidade.map((a) => ({
            arquivoId: a.arquivoId,
            nomeArquivo: a.nomeArquivo,
            motivo: a.motivos.join(', '),
            motivos: a.motivos,
            arquivoOriginalId: a.arquivoOriginalId,
            ocorrencias: a.ocorrencias,
          })),
          instrucoes: temAlertaDuplicidade
            ? 'Reenvie a requisição com o campo `forcarReprocessamento=true` (query string ou multipart) para reprocessar os arquivos duplicados.'
            : undefined,
        };

        return reply.status(temAlertaDuplicidade ? 409 : 202).send(resposta);
      } catch (err: any) {
        request.log.error(err, 'Erro ao recepcionar lote de arquivos para importação');
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: err.message || 'Falha ao salvar arquivos do lote.',
        });
      }
    });

    /**
     * GET /api/importacao/lotes
     * Lista lotes do usuário logado.
     */
    authApp.get('/lotes', async (request, reply) => {
      const usuarioId = request.user.sub;
      const query = queryLotesImportacaoSchema.safeParse(request.query);

      if (!query.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Parâmetros de consulta inválidos.',
          issues: query.error.issues,
        });
      }

      const lotes = await storageService.listarLotesUsuario(usuarioId, {
        status: query.data.status,
        limite: query.data.limite,
      });

      return reply.send({ lotes });
    });

    /**
     * GET /api/importacao/lotes/:id
     * Consulta detalhes de um lote específico (com arquivos e status) do usuário.
     */
    authApp.get('/lotes/:id', async (request, reply) => {
      const usuarioId = request.user.sub;
      const params = loteIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'ID do lote inválido.',
          issues: params.error.issues,
        });
      }

      const lote = await storageService.obterLotePorId(params.data.id, usuarioId);

      if (!lote) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Lote de importação não encontrado.',
        });
      }

      return reply.send({ lote });
    });

    /**
     * POST /api/importacao/lotes/:id/processar-ia
     * Aciona o processamento sequencial de extração com IA para os arquivos pendentes do lote.
     */
    authApp.post('/lotes/:id/processar-ia', async (request, reply) => {
      const usuarioId = request.user.sub;
      const params = loteIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'ID do lote inválido.',
          issues: params.error.issues,
        });
      }

      const lote = await storageService.obterLotePorId(params.data.id, usuarioId);
      if (!lote) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Lote de importação não encontrado.',
        });
      }

      const bodyResult = processarLoteIaBodySchema.safeParse(request.body || {});
      const opcoesIa = bodyResult.success ? bodyResult.data : undefined;

      const { importacaoIaWorkerService } = await import('./worker/importacao-ia-worker.service.js');
      const resultado = await importacaoIaWorkerService.processarLote(lote.id, opcoesIa);

      return reply.status(200).send({
        statusCode: 200,
        message: 'Processamento de extração IA concluído para o lote.',
        resultado,
      });
    });

    /**
     * POST /api/importacao/arquivos/:id/reprocessar-ia
     * Reprocessa individualmente um arquivo com erro usando a IA ou modelo especificados.
     * Não descarta o progresso dos demais arquivos já concluídos do lote.
     */
    authApp.post('/arquivos/:id/reprocessar-ia', async (request, reply) => {
      const usuarioId = request.user.sub;
      const params = arquivoIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'ID do arquivo inválido.',
          issues: params.error.issues,
        });
      }

      const bodyResult = reprocessarArquivoIaBodySchema.safeParse(request.body || {});
      if (!bodyResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Parâmetros de reprocessamento inválidos.',
          issues: bodyResult.error.issues,
        });
      }

      const { importacaoIaWorkerService } = await import('./worker/importacao-ia-worker.service.js');

      try {
        const resultado = await importacaoIaWorkerService.reprocessarArquivoIndividualComIa({
          arquivoId: params.data.id,
          usuarioId,
          provedorIa: bodyResult.data.provedorIa,
          modeloIa: bodyResult.data.modeloIa,
        });

        if (!resultado.sucesso) {
          return reply.status(422).send({
            statusCode: 422,
            error: 'Unprocessable Entity',
            message: resultado.erro || 'Falha ao reprocessar arquivo com a IA especificada.',
            resultado,
          });
        }

        return reply.status(200).send({
          statusCode: 200,
          message: 'Arquivo reprocessado com sucesso pela IA.',
          resultado,
        });
      } catch (err: any) {
        const status = err.message?.includes('não encontrado') ? 404 : 500;
        return reply.status(status).send({
          statusCode: status,
          error: status === 404 ? 'Not Found' : 'Internal Server Error',
          message: err.message || 'Erro ao reprocessar arquivo individual.',
        });
      }
    });

    /**
     * GET /api/importacao/arquivos/:id/tentativas
     * TASK-50: lista paginada do histórico de tentativas (execuções) de um arquivo,
     * ordenado cronologicamente por número da tentativa. Filtrado por usuarioId.
     *
     * Query: ?pagina=1&limite=20&status=SUCESSO|FALHA|DUPLICADO
     */
    authApp.get('/arquivos/:id/tentativas', async (request, reply) => {
      const usuarioId = request.user.sub;
      const params = arquivoIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'ID do arquivo inválido.',
          issues: params.error.issues,
        });
      }

      const query = queryTentativasArquivoSchema.safeParse(request.query || {});
      if (!query.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Parâmetros de consulta inválidos.',
          issues: query.error.issues,
        });
      }

      // Isolamento multi-tenant: valida que o arquivo pertence ao usuário autenticado
      const { prisma } = await import('../../infrastructure/database/prisma.js');
      const arquivo = await prisma.arquivoImportacao.findFirst({
        where: { id: params.data.id, lote: { usuarioId } },
        select: {
          id: true,
          nomeArquivo: true,
          totalTentativas: true,
          jaImportadoAnteriormente: true,
          statusFinal: true,
          ultimoProvedor: true,
        },
      });

      if (!arquivo) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Arquivo de importação não encontrado.',
        });
      }

      const resultado = await ImportacaoTentativasService.listarTentativasArquivo({
        usuarioId,
        arquivoId: arquivo.id,
        pagina: query.data.pagina,
        limite: query.data.limite,
        status: query.data.status,
      });

      return reply.status(200).send({
        arquivo,
        arquivoId: arquivo.id,
        total: resultado.total,
        pagina: resultado.pagina,
        limite: resultado.limite,
        totalPaginas: resultado.totalPaginas,
        tentativas: resultado.tentativas,
      });
    });

    /**
     * POST /api/importacao/arquivos/:id/confirmar-reprocessamento
     * TASK-50: confirma explicitamente o reprocessamento de um arquivo sinalizado como
     * já importado anteriormente, liberando-o para o pipeline e registrando a nova tentativa
     * ao executar a IA.
     */
    authApp.post('/arquivos/:id/confirmar-reprocessamento', async (request, reply) => {
      const usuarioId = request.user.sub;
      const params = arquivoIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'ID do arquivo inválido.',
          issues: params.error.issues,
        });
      }

      const { prisma } = await import('../../infrastructure/database/prisma.js');
      const arquivo = await prisma.arquivoImportacao.findFirst({
        where: { id: params.data.id, lote: { usuarioId } },
        select: { id: true, nomeArquivo: true, loteId: true, jaImportadoAnteriormente: true },
      });

      if (!arquivo) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Arquivo de importação não encontrado.',
        });
      }

      const atualizado = await prisma.arquivoImportacao.update({
        where: { id: arquivo.id },
        data: { jaImportadoAnteriormente: false, statusFinal: null },
        select: { id: true, nomeArquivo: true, jaImportadoAnteriormente: true, statusFinal: true },
      });

      await ImportacaoTentativasService.recalcularContadoresLote(arquivo.loteId);

      return reply.status(200).send({
        statusCode: 200,
        message: `Reprocessamento confirmado para o arquivo "${arquivo.nomeArquivo}".`,
        arquivo: atualizado,
        loteId: arquivo.loteId,
      });
    });

    /**
     * DELETE /api/importacao/arquivos/:id
     * Exclui um arquivo do lote de importação (ex: arquivo com erro, arquivo indesejado ou incompatível).
     * Remove do disco, da staging e do banco, atualizando as métricas do lote pai.
     */
    authApp.delete('/arquivos/:id', async (request, reply) => {
      const usuarioId = request.user.sub;
      const params = arquivoIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'ID do arquivo inválido.',
          issues: params.error.issues,
        });
      }

      try {
        const resultado = await storageService.excluirArquivoImportacao(
          params.data.id,
          usuarioId
        );

        return reply.status(200).send({
          statusCode: 200,
          message: `Arquivo ${resultado.nomeArquivo} excluído com sucesso do lote.`,
          resultado,
        });
      } catch (err: any) {
        const isNotFound = err.message?.includes('não encontrado');
        const isForbidden = err.message?.includes('Acesso negado');
        const status = isNotFound ? 404 : isForbidden ? 403 : 500;

        return reply.status(status).send({
          statusCode: status,
          error: isNotFound ? 'Not Found' : isForbidden ? 'Forbidden' : 'Internal Server Error',
          message: err.message || 'Erro ao excluir arquivo de importação.',
        });
      }
    });

    /**
     * POST /api/importacao/lotes/:id/carregar-staging
     * Aciona o Worker 2 para carregar arquivos em IA_CONCLUIDO para a tabela de staging.
     */
    authApp.post('/lotes/:id/carregar-staging', async (request, reply) => {
      const usuarioId = request.user.sub;
      const params = loteIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'ID do lote inválido.',
          issues: params.error.issues,
        });
      }

      const lote = await storageService.obterLotePorId(params.data.id, usuarioId);
      if (!lote) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Lote de importação não encontrado.',
        });
      }

      const { importacaoStagingWorkerService } = await import(
        './worker/importacao-staging-worker.service.js'
      );
      const resultado = await importacaoStagingWorkerService.carregarLoteParaStaging(
        lote.id,
        usuarioId
      );

      return reply.status(200).send({
        statusCode: 200,
        message: 'Carga de staging concluída para o lote.',
        resultado,
      });
    });

    /**
     * POST /api/importacao/lotes/:id/consolidar
     * Aciona o Worker 3 para consolidação com auto-cadastro de contas e regras anti-dupla contagem.
     */
    authApp.post('/lotes/:id/consolidar', async (request, reply) => {
      const usuarioId = request.user.sub;
      const params = loteIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'ID do lote inválido.',
          issues: params.error.issues,
        });
      }

      const lote = await storageService.obterLotePorId(params.data.id, usuarioId);
      if (!lote) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Lote de importação não encontrado.',
        });
      }

      const { importacaoConsolidacaoWorkerService } = await import(
        './worker/importacao-consolidacao-worker.service.js'
      );
      const resultado = await importacaoConsolidacaoWorkerService.consolidarLote(
        lote.id,
        usuarioId
      );

      return reply.status(200).send({
        statusCode: 200,
        message: 'Consolidação de negócio concluída com sucesso.',
        resultado,
      });
    });

    /**
     * GET /api/importacao/lotes/:id/staging
     * Consulta registros da tabela de staging do lote para auditoria e monitoramento.
     */
    authApp.get('/lotes/:id/staging', async (request, reply) => {
      const usuarioId = request.user.sub;
      const params = loteIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'ID do lote inválido.',
          issues: params.error.issues,
        });
      }

      const lote = await storageService.obterLotePorId(params.data.id, usuarioId);
      if (!lote) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Lote de importação não encontrado.',
        });
      }

      const { prisma } = await import('../../infrastructure/database/prisma.js');
      const stagingItens = await prisma.stagingLancamentoImportacao.findMany({
        where: { loteId: lote.id },
        orderBy: { dataMovimento: 'asc' },
      });

      return reply.status(200).send({
        loteId: lote.id,
        totalItens: stagingItens.length,
        itens: stagingItens,
      });
    });

    /**
     * GET /api/importacao/alertas
     * Retorna os alertas de conciliação do usuário (lacunas de extrato e faturas pendentes).
     */
    authApp.get('/alertas', async (request, reply) => {
      const usuarioId = request.user.sub;
      const { queryAlertasConciliacaoSchema } = await import('./importacao.schema.js');
      const { conciliacaoService } = await import('./conciliacao.service.js');

      const parsedQuery = queryAlertasConciliacaoSchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Parâmetros de consulta inválidos.',
          details: parsedQuery.error.format(),
        });
      }

      const alertas = await conciliacaoService.listarAlertas(usuarioId, parsedQuery.data.status as any);
      return reply.status(200).send({ alertas });
    });

    /**
     * PATCH /api/importacao/alertas/:id/dispensar
     * Descarta um alerta de conciliação registrando o motivo (ex: CONTA_ENCERRADA, SEM_GASTOS).
     */
    authApp.patch('/alertas/:id/dispensar', async (request, reply) => {
      const usuarioId = request.user.sub;
      const { alertaIdParamSchema, dispensarAlertaBodySchema } = await import('./importacao.schema.js');
      const { conciliacaoService } = await import('./conciliacao.service.js');

      const parsedParams = alertaIdParamSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'ID do alerta inválido.',
          details: parsedParams.error.format(),
        });
      }

      const parsedBody = dispensarAlertaBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Corpo da requisição inválido.',
          details: parsedBody.error.format(),
        });
      }

      try {
        const alertaAtualizado = await conciliacaoService.dispensarAlerta({
          usuarioId,
          alertaId: parsedParams.data.id,
          motivoDispensa: parsedBody.data.motivoDispensa,
        });

        return reply.status(200).send({
          statusCode: 200,
          message: 'Alerta dispensado com sucesso.',
          alerta: alertaAtualizado,
        });
      } catch (err: any) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: err.message || 'Alerta não encontrado.',
        });
      }
    });

    /**
     * GET /api/importacao/historico-arquivos
     * Retorna o histórico catalogado de arquivos importados pelo usuário.
     */
    authApp.get('/historico-arquivos', async (request, reply) => {
      const usuarioId = request.user.sub;
      const { conciliacaoService } = await import('./conciliacao.service.js');

      const historico = await conciliacaoService.listarHistoricoArquivos(usuarioId);
      return reply.status(200).send({ historico });
    });

    /**
     * GET /api/importacao/arquivos/:id/lancamentos
     * Retorna os detalhes consolidados, resumo analítico e a lista de lançamentos criados
     * a partir de um arquivo importado específico pelo usuário.
     */
    authApp.get('/arquivos/:id/lancamentos', async (request, reply) => {
      const usuarioId = request.user.sub;
      const params = arquivoIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'ID do arquivo inválido.',
          issues: params.error.issues,
        });
      }

      const { conciliacaoService } = await import('./conciliacao.service.js');

      try {
        const dados = await conciliacaoService.obterLancamentosArquivo(params.data.id, usuarioId);
        return reply.status(200).send(dados);
      } catch (err: any) {
        const isNotFound = err.message?.includes('não encontrado') || err.message?.includes('não autorizado');
        const status = isNotFound ? 404 : 500;
        return reply.status(status).send({
          statusCode: status,
          error: isNotFound ? 'Not Found' : 'Internal Server Error',
          message: err.message || 'Erro ao carregar lançamentos do arquivo.',
        });
      }
    });

    /**
     * GET /api/importacao/stream-eventos
     * Endpoint Server-Sent Events (SSE) em tempo real transmitindo eventos do pipeline:
     * - Arquivos em progresso / IA
     * - Carga em staging
     * - Transações consolidadas ao vivo
     * - Conclusão de lotes
     */
    authApp.get('/stream-eventos', async (request, reply) => {
      const usuarioId = request.user.sub;

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.flushHeaders?.();

      const sendEvent = (event: string, data: any) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Ping inicial de conexão
      sendEvent('connected', { usuarioId, timestamp: new Date() });

      // Se solicitado em ambiente de teste, encerra a resposta para evitar timeout de inject
      if ((request.query as any)?.testClose === 'true') {
        reply.raw.end();
        return;
      }

      const onArquivoProgresso = (ev: any) => {
        sendEvent('arquivo_progresso', ev);
      };

      const onArquivoConsolidado = (ev: any) => {
        if (ev.usuarioId === usuarioId) {
          sendEvent('arquivo_consolidado', ev);
        }
      };

      const onStagingCarregado = (ev: any) => {
        if (ev.usuarioId === usuarioId) {
          sendEvent('staging_carregado', ev);
        }
      };

      const onTransacaoConsolidada = (ev: any) => {
        if (ev.usuarioId === usuarioId) {
          sendEvent('transacao_consolidada', ev);
        }
      };

      const onLoteConcluido = (ev: any) => {
        if (ev.usuarioId === usuarioId) {
          sendEvent('lote_concluido', ev);
        }
      };

      const { importacaoEventBus } = await import('../../infrastructure/events/importacao-event-bus.js');
      importacaoEventBus.on('importacao:arquivo_progresso', onArquivoProgresso);
      importacaoEventBus.on('importacao:arquivo_consolidado_pronto', onArquivoConsolidado);
      importacaoEventBus.on('importacao:arquivo_staging_carregado', onStagingCarregado);
      importacaoEventBus.on('importacao:transacao_consolidada', onTransacaoConsolidada);
      importacaoEventBus.on('importacao:lote_concluido', onLoteConcluido);

      // Heartbeat a cada 20s para manter conexão viva
      const heartbeatTimer = setInterval(() => {
        reply.raw.write(': heartbeat\n\n');
      }, 20000);

      request.raw.on('close', () => {
        clearInterval(heartbeatTimer);
        importacaoEventBus.removeListener('importacao:arquivo_progresso', onArquivoProgresso);
        importacaoEventBus.removeListener('importacao:arquivo_consolidado_pronto', onArquivoConsolidado);
        importacaoEventBus.removeListener('importacao:arquivo_staging_carregado', onStagingCarregado);
        importacaoEventBus.removeListener('importacao:transacao_consolidada', onTransacaoConsolidada);
        importacaoEventBus.removeListener('importacao:lote_concluido', onLoteConcluido);
      });
    });
  });
};
