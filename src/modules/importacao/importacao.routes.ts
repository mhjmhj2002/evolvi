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
import { prisma } from '../../infrastructure/database/prisma.js';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { env } from '../../config/env.js';

async function removerSpoolSeVazio(): Promise<void> {
  const spool = path.resolve(process.cwd(), env.UPLOADS_DIR, '.spool');
  const raizUploads = path.resolve(process.cwd(), env.UPLOADS_DIR);
  if (!spool.startsWith(`${raizUploads}${path.sep}`)) throw new Error('Caminho de spool inválido.');
  try {
    await fs.rmdir(spool);
  } catch (erro: any) {
    if (erro?.code !== 'ENOENT' && erro?.code !== 'ENOTEMPTY' && erro?.code !== 'EEXIST') throw erro;
  }
}

export const importacaoRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const storageService = new ImportacaoStorageService();

  // Registra suporte a multipart/form-data com limites generosos para pastas e faturas
  const maxArquivoBytes = 50 * 1024 * 1024;
  const maxLoteBytes = 500 * 1024 * 1024;
  await app.register(multipart, {
    limits: {
      fileSize: maxArquivoBytes,
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

      const ativos = await prisma.arquivoImportacao.aggregate({
        where: { usuarioId, status: { in: ['RECEPCIONADO', 'ENVIADO_IA', 'IA_CONCLUIDO', 'STAGING_CARREGADO'] } },
        _sum: { tamanhoBytes: true },
      });
      const bytesAtivos = Number(ativos._sum.tamanhoBytes || 0);
      const maxUsuarioBytes = 1024 * 1024 * 1024;
      if (bytesAtivos >= maxUsuarioBytes) {
        return reply.status(413).send({ message: 'Limite de 1 GB de uploads ativos por usuário atingido.' });
      }
      const files: SalvarArquivoInput[] = [];
      let totalBytes = 0;
      let provedorIa: string | undefined =
        queryUpload.provedorIa || (request.query as any)?.provedorIa;
      let modeloIa: string | undefined = queryUpload.modeloIa || (request.query as any)?.modeloIa;
      let forcarReprocessamento = Boolean(queryUpload.forcarReprocessamento);
      let origem: 'UPLOAD' | 'PASTA' | undefined = queryUpload.origem;
      const parts = request.parts();

      try {
      for await (const part of parts) {
        if (part.type === 'file') {
          if (files.length >= 100) throw new Error('O lote pode conter no máximo 100 arquivos.');
          const extensao = path.extname(path.basename(part.filename || '')).toLowerCase();
          if (extensao !== '.pdf' && extensao !== '.csv') {
            throw new Error('Formato não suportado. Envie somente arquivos PDF ou CSV.');
          }
          const tempDir = path.join(env.UPLOADS_DIR, '.spool');
          await fs.mkdir(tempDir, { recursive: true });
          const caminhoTemporario = path.join(tempDir, randomUUID());
          const uploadIniciadoEm = new Date();
          let tamanhoBytes = 0;
          const hash = createHash('sha256');
          const contador = new Transform({ transform(chunk, _encoding, callback) {
            tamanhoBytes += chunk.length;
            totalBytes += chunk.length;
            if (tamanhoBytes > maxArquivoBytes || totalBytes > maxLoteBytes || bytesAtivos + totalBytes > maxUsuarioBytes) {
              callback(new Error(tamanhoBytes > maxArquivoBytes
                ? 'Cada arquivo pode ter no máximo 50 MB.'
                : totalBytes > maxLoteBytes ? 'O lote pode ter no máximo 500 MB.' : 'O limite de 1 GB de uploads ativos por usuário seria excedido.'));
              return;
            }
            hash.update(chunk);
            callback(null, chunk);
          }});
          try {
            await pipeline(part.file, contador, createWriteStream(caminhoTemporario, { flags: 'wx' }));
          } catch (error) {
            await fs.rm(caminhoTemporario, { force: true });
            await removerSpoolSeVazio();
            throw error;
          }
          if (part.file.truncated) {
            await fs.rm(caminhoTemporario, { force: true });
            await removerSpoolSeVazio();
            throw new Error('O arquivo excede o limite de 50 MB.');
          }
          // filename pode vir com caminho relativo se enviado via input com webkitdirectory
          const nomeOriginal = part.filename || `arquivo_${Date.now()}`;
          files.push({
            nomeOriginal,
            caminhoTemporario,
            tamanhoBytes,
            hashConteudo: hash.digest('hex'),
            mimeType: part.mimetype,
            uploadIniciadoEm,
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
      } catch (error) {
        await Promise.all(files.map((file) => file.caminhoTemporario
          ? fs.rm(file.caminhoTemporario, { force: true }) : Promise.resolve()));
        await removerSpoolSeVazio();
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('somente arquivos PDF ou CSV')) {
          return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message });
        }
        return reply.status(413).send({ statusCode: 413, error: 'Payload Too Large', message });
      }

      if (files.length === 0) {
        await removerSpoolSeVazio();
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
        await removerSpoolSeVazio();

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
        await Promise.all(files.map((file) => file.caminhoTemporario
          ? fs.rm(file.caminhoTemporario, { force: true }) : Promise.resolve()));
        await removerSpoolSeVazio();
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

    authApp.get('/arquivos/:id/inventario-ia', async (request, reply) => {
      const usuarioId = request.user.sub;
      const params = arquivoIdParamSchema.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ message: 'ID do arquivo inválido.' });
      const inventarios = await prisma.inventarioIaArquivo.findMany({
        where: { arquivoId: params.data.id, usuarioId },
        include: { paginas: { where: { usuarioId }, orderBy: { pagina: 'asc' } } },
        orderBy: { criadoEm: 'desc' }, take: 10,
      });
      if (inventarios.length === 0) return reply.status(404).send({ message: 'Inventário IA não encontrado.' });
      const arquivo = await prisma.arquivoImportacao.findFirst({
        where: { id: params.data.id, usuarioId },
        select: { id: true, nomeArquivo: true, status: true, statusFinal: true },
      });
      if (!arquivo) return reply.status(404).send({ message: 'Arquivo de importação não encontrado.' });
      return reply.send({ arquivo, inventarios });
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

      // Dispara o processamento do lote pelo Worker 1 em segundo plano
      const { importacaoIaWorkerService } = await import('./worker/importacao-ia-worker.service.js');
      importacaoIaWorkerService.processarLote(arquivo.loteId).catch((err: unknown) => {
        console.error(
          `[ImportacaoRoutes] Erro ao disparar processamento pós-confirmação do lote ${arquivo.loteId}:`,
          err
        );
      });

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

    authApp.post('/arquivos/:id/reprocessar-consolidacao', async (request, reply) => {
      const params = arquivoIdParamSchema.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ statusCode: 400, message: 'ID do arquivo inválido.' });
      const { importacaoConsolidacaoWorkerService } = await import('./worker/importacao-consolidacao-worker.service.js');
      try {
        const resultado = await importacaoConsolidacaoWorkerService.reprocessarArquivoInconsistente(params.data.id, request.user.sub);
        return reply.status(200).send({ statusCode: 200, message: 'Arquivo reprocessado com validação de persistência.', resultado });
      } catch (err) {
        return reply.status(404).send({ statusCode: 404, message: err instanceof Error ? err.message : 'Arquivo não encontrado.' });
      }
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

      const query = (request.query || {}) as { cursor?: string; limite?: string; arquivoId?: string; status?: string };
      const limite = Math.min(200, Math.max(1, Number.parseInt(query.limite || '100', 10) || 100));
      const where: any = { loteId: lote.id };
      if (query.arquivoId) where.arquivoId = query.arquivoId;
      if (query.status) where.statusProcessamento = query.status;
      const staging = await prisma.stagingLancamentoImportacao.findMany({
        where,
        orderBy: [{ dataMovimento: 'asc' }, { id: 'asc' }],
        take: limite + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const temProximaPagina = staging.length > limite;
      const stagingItens = temProximaPagina ? staging.slice(0, limite) : staging;
      const [totalItens, totais] = await Promise.all([
        prisma.stagingLancamentoImportacao.count({ where }),
        prisma.stagingLancamentoImportacao.groupBy({ by: ['statusProcessamento'], where, _count: { _all: true } }),
      ]);

      return reply.status(200).send({
        loteId: lote.id,
        totalItens,
        limite,
        proximoCursor: temProximaPagina ? stagingItens[stagingItens.length - 1]?.id ?? null : null,
        totaisPorStatus: Object.fromEntries(totais.map((item) => [item.statusProcessamento, item._count._all])),
        itens: stagingItens,
      });
    });

    authApp.get('/lotes/:id/metricas', async (request, reply) => {
      const usuarioId = request.user.sub;
      const params = loteIdParamSchema.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ statusCode: 400, message: 'ID do lote inválido.' });
      const lote = await prisma.loteImportacao.findFirst({
        where: { id: params.data.id, usuarioId },
        select: { id: true, criadoEm: true, iniciadoEm: true, finalizadoEm: true, workerAttempts: true, workerLeaseUntil: true },
      });
      if (!lote) return reply.status(404).send({ statusCode: 404, message: 'Lote de importação não encontrado.' });

      const [arquivos, stagingPorStatus] = await Promise.all([
        prisma.arquivoImportacao.findMany({ where: { loteId: lote.id, usuarioId }, select: { id: true, status: true, tamanhoBytes: true, duracaoStagingMs: true, duracaoConsolidacaoMs: true } }),
        prisma.stagingLancamentoImportacao.groupBy({ by: ['statusProcessamento'], where: { loteId: lote.id }, _count: { _all: true } }),
      ]);
      const arquivoIds = arquivos.map((arquivo) => arquivo.id);
      const [tentativas, usoIa] = await Promise.all([
        prisma.tentativaArquivoImportacao.findMany({
          where: { usuarioId, arquivoId: { in: arquivoIds } },
          select: { status: true, duracaoMs: true, totalTransacoesExtraidas: true, numeroTentativa: true, arquivoId: true },
          orderBy: { criadoEm: 'asc' },
          take: 5000,
        }),
        prisma.usoIaLog.aggregate({
          where: { usuarioId, loteId: lote.id },
          _sum: { tokensPrompt: true, tokensResposta: true, tokensTotal: true, custoUsd: true, custoBrl: true, duracaoMs: true },
          _count: { _all: true },
        }),
      ]);
      const duracoes = tentativas.map((t) => t.duracaoMs).sort((a, b) => a - b);
      const percentil = (p: number) => duracoes.length ? duracoes[Math.min(duracoes.length - 1, Math.ceil(duracoes.length * p) - 1)] : null;
      const resumoDuracoes = (valores: number[]) => {
        const ordenadas = valores.filter((valor) => valor > 0).sort((a, b) => a - b);
        return { p50: ordenadas.length ? ordenadas[Math.min(ordenadas.length - 1, Math.ceil(ordenadas.length * 0.5) - 1)] : null,
          p95: ordenadas.length ? ordenadas[Math.min(ordenadas.length - 1, Math.ceil(ordenadas.length * 0.95) - 1)] : null };
      };
      const janelasMs = lote.finalizadoEm
        ? lote.finalizadoEm.getTime() - (lote.iniciadoEm ?? lote.criadoEm).getTime()
        : Date.now() - (lote.iniciadoEm ?? lote.criadoEm).getTime();
      const totalBytes = arquivos.reduce((soma, arquivo) => soma + Number(arquivo.tamanhoBytes), 0);
      const falhas = tentativas.filter((t) => t.status === 'FALHA').length;
      const maiorTentativaPorArquivo = new Map<string, number>();
      for (const tentativa of tentativas) maiorTentativaPorArquivo.set(tentativa.arquivoId, Math.max(maiorTentativaPorArquivo.get(tentativa.arquivoId) || 0, tentativa.numeroTentativa));
      const retries = [...maiorTentativaPorArquivo.values()].reduce((soma, numero) => soma + Math.max(0, numero - 1), 0);

      return reply.status(200).send({
        loteId: lote.id,
        fila: { aguardando: arquivos.filter((a) => a.status === 'RECEPCIONADO' || a.status === 'ENVIADO_IA').length, leaseAtivo: Boolean(lote.workerLeaseUntil && lote.workerLeaseUntil > new Date()), tentativasWorker: lote.workerAttempts },
        arquivos: { total: arquivos.length, bytes: totalBytes, porStatus: Object.fromEntries([...new Set(arquivos.map((a) => a.status))].map((status) => [status, arquivos.filter((a) => a.status === status).length])) },
        staging: Object.fromEntries(stagingPorStatus.map((item) => [item.statusProcessamento, item._count._all])),
        etapas: { ia: resumoDuracoes(tentativas.map((t) => t.duracaoMs)), staging: resumoDuracoes(arquivos.map((a) => a.duracaoStagingMs)), consolidacao: resumoDuracoes(arquivos.map((a) => a.duracaoConsolidacaoMs)) },
        ia: { chamadas: usoIa._count._all, falhas, retries, duracaoMs: { p50: percentil(0.5), p95: percentil(0.95) }, tokensPrompt: usoIa._sum.tokensPrompt ?? 0, tokensResposta: usoIa._sum.tokensResposta ?? 0, tokensTotal: usoIa._sum.tokensTotal ?? 0, custoUsd: usoIa._sum.custoUsd ?? 0, custoBrl: usoIa._sum.custoBrl ?? 0 },
        processamento: { duracaoLoteMs: Math.max(0, janelasMs), arquivosPorMinuto: janelasMs > 0 ? arquivos.length * 60_000 / janelasMs : null, linhasPorMinuto: janelasMs > 0 ? tentativas.reduce((soma, t) => soma + t.totalTransacoesExtraidas, 0) * 60_000 / janelasMs : null },
        processo: { rssBytes: process.memoryUsage().rss },
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
     * DELETE /api/importacao/arquivos/:id/fatura
     * Exclui a importação de uma fatura de cartão e todos os seus lançamentos vinculados,
     * permitindo reimportar o documento sem duplicidade ou resquícios.
     */
    authApp.delete('/arquivos/:id/fatura', async (request, reply) => {
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
        const resultado = await conciliacaoService.excluirImportacaoFaturaComLancamentos(
          params.data.id,
          usuarioId
        );

        return reply.status(200).send({
          statusCode: 200,
          message: `Fatura "${resultado.nomeArquivo}" e seus lançamentos foram excluídos com sucesso.`,
          resultado,
        });
      } catch (err: any) {
        const isNotFound = err.message?.includes('não encontrado') || err.message?.includes('não autorizado');
        const status = isNotFound ? 404 : 500;
        return reply.status(status).send({
          statusCode: status,
          error: isNotFound ? 'Not Found' : 'Internal Server Error',
          message: err.message || 'Erro ao excluir importação da fatura.',
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

      let encerrado = false;
      let heartbeatTimer: NodeJS.Timeout | undefined;
      const listeners: Array<[string, (...args: any[]) => void]> = [];
      const limpar = () => {
        if (encerrado) return;
        encerrado = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        for (const [event, listener] of listeners) importacaoEventBus.removeListener(event, listener);
        request.raw.off('close', limpar);
        request.raw.off('aborted', limpar);
        reply.raw.off('close', limpar);
        reply.raw.off('error', limpar);
      };
      const sendEvent = (event: string, data: any): boolean => {
        if (encerrado || reply.raw.destroyed || reply.raw.writableEnded) return false;
        try {
          if (reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) return true;
        } catch {
          // O socket já pode ter sido encerrado pelo cliente.
        }
        // Sem fila ilimitada: o cliente lento reconecta e recupera o estado via API.
        limpar();
        if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
        return false;
      };

      const { importacaoEventBus } = await import('../../infrastructure/events/importacao-event-bus.js');
      request.raw.on('close', limpar);
      request.raw.on('aborted', limpar);
      reply.raw.on('close', limpar);
      reply.raw.on('error', limpar);

      // Ping inicial de conexão
      if (!sendEvent('connected', { usuarioId, timestamp: new Date() })) {
        if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
        return;
      }

      // Se solicitado em ambiente de teste, encerra a resposta para evitar timeout de inject
      if ((request.query as any)?.testClose === 'true') {
        reply.raw.end();
        return;
      }

      const onArquivoProgresso = (ev: any) => {
        if (ev.usuarioId === usuarioId) sendEvent('arquivo_progresso', ev);
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

      listeners.push(
        ['importacao:arquivo_progresso', onArquivoProgresso],
        ['importacao:arquivo_consolidado_pronto', onArquivoConsolidado],
        ['importacao:arquivo_staging_carregado', onStagingCarregado],
        ['importacao:transacao_consolidada', onTransacaoConsolidada],
        ['importacao:lote_concluido', onLoteConcluido],
      );
      for (const [event, listener] of listeners) importacaoEventBus.on(event, listener);

      // Heartbeat a cada 20s para manter conexão viva
      heartbeatTimer = setInterval(() => {
        if (encerrado || reply.raw.destroyed || reply.raw.writableEnded) return limpar();
        try {
          if (!reply.raw.write(': heartbeat\n\n')) {
            limpar();
            if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
          }
        } catch {
          limpar();
        }
      }, 20000);
    });
  });
};
