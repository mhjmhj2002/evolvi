import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import { ensureAuthenticated } from '../../middlewares/auth.middleware.js';
import { ImportacaoStorageService, SalvarArquivoInput } from './importacao-storage.service.js';
import { queryLotesImportacaoSchema, loteIdParamSchema } from './importacao.schema.js';

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
     * Salva no disco temporário com o padrão uploads/yyyy-mm-dd-hh-mm-ss-{usuarioId}/
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

      const files: SalvarArquivoInput[] = [];
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
        });

        // HTTP 202 Accepted para resposta imediata assíncrona
        return reply.status(202).send({
          statusCode: 202,
          message: 'Arquivos recepcionados com sucesso na pasta temporária do servidor.',
          loteId: resultado.loteId,
          status: resultado.status,
          totalArquivos: resultado.totalArquivos,
          caminhoDiretorio: resultado.caminhoDiretorio,
          arquivos: resultado.arquivos,
        });
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

      const { importacaoIaWorkerService } = await import('./worker/importacao-ia-worker.service.js');
      const resultado = await importacaoIaWorkerService.processarLote(lote.id);

      return reply.status(200).send({
        statusCode: 200,
        message: 'Processamento de extração IA concluído para o lote.',
        resultado,
      });
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
