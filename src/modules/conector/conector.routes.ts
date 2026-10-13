import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ensureAuthenticated } from '../../middlewares/auth.middleware.js';
import { BankHubService } from './bank-hub.service.js';
import {
  connectInstitutionSchema,
  syncConnectionSchema,
  parseStatementSchema,
  importStatementSchema,
} from './conector.schema.js';

export const conectorRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const hubService = new BankHubService();

  // Instituições suportadas (público / autenticado)
  // Instituições suportadas e modo de operação (público / autenticado)
  app.get('/instituicoes', async (_request, reply) => {
    const { env } = await import('../../config/env.js');
    const instituicoes = hubService.listInstitutions();
    return reply.send({
      instituicoes,
      modoOpenFinance: env.OPEN_FINANCE_MODE,
      apiRealConfigurada: Boolean(env.OPEN_FINANCE_CLIENT_ID && env.OPEN_FINANCE_API_URL),
    });
  });

  // Rotas autenticadas do Hub
  app.register(async (authApp) => {
    authApp.addHook('preHandler', ensureAuthenticated);

    // Listar conexões ativas do usuário
    authApp.get('/conexoes', async (request, reply) => {
      const usuarioId = request.user.sub;
      const conexoes = await hubService.listUserConnections(usuarioId);
      return reply.send({ conexoes });
    });

    // Conectar nova instituição
    authApp.post('/conexoes', async (request, reply) => {
      const usuarioId = request.user.sub;
      const body = connectInstitutionSchema.safeParse(request.body);

      if (!body.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Parâmetros de conexão inválidos',
          issues: body.error.issues,
        });
      }

      try {
        const resultado = await hubService.connectInstitution({
          usuarioId,
          instituicaoCodigo: body.data.instituicaoCodigo,
          consentimentoConfirmado: body.data.consentimentoConfirmado,
          escopo: body.data.escopo,
          credentials: body.data.credentials,
        });

        return reply.status(201).send(resultado);
      } catch (err: unknown) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err instanceof Error ? err.message : 'Falha ao conectar instituição',
        });
      }
    });

    // Sincronizar conexão
    authApp.post('/conexoes/:id/sincronizar', async (request, reply) => {
      const usuarioId = request.user.sub;
      const { id } = request.params as { id: string };
      const body = syncConnectionSchema.safeParse(request.body || {});

      try {
        const resultado = await hubService.syncConnection({
          usuarioId,
          conexaoId: id,
          dataInicio: body.success ? body.data.dataInicio : undefined,
          dataFim: body.success ? body.data.dataFim : undefined,
        });

        return reply.send(resultado);
      } catch (err: unknown) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err instanceof Error ? err.message : 'Falha na sincronização',
        });
      }
    });

    // Desconectar / Revogar / Excluir
    authApp.delete('/conexoes/:id', async (request, reply) => {
      const usuarioId = request.user.sub;
      const { id } = request.params as { id: string };
      const { purge } = request.query as { purge?: string };
      const shouldPurge = purge === 'true' || purge === '1';

      try {
        const conexao = await hubService.disconnect({ usuarioId, conexaoId: id, purge: shouldPurge });
        return reply.send({
          message: shouldPurge ? 'Conexão excluída com sucesso' : 'Conexão revogada com sucesso',
          conexao,
        });
      } catch (err: unknown) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: err instanceof Error ? err.message : 'Conexão não encontrada',
        });
      }
    });

    // Parser de prévia de extrato (sem gravar ainda)
    authApp.post('/parser', async (request, reply) => {
      const body = parseStatementSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Conteúdo para parsing inválido',
          issues: body.error.issues,
        });
      }

      const parseResult = hubService.parseStatement(body.data.content, body.data.filename);
      return reply.send(parseResult);
    });

    // Executar ciclo do Scheduler sob demanda ou testar agendamento (TASK-28)
    authApp.post('/scheduler/executar', async (_request, reply) => {
      const { openFinanceSchedulerService } = await import('./scheduler/open-finance-scheduler.service.js');
      const resultado = await openFinanceSchedulerService.runJobCycle();
      return reply.send({
        message: 'Ciclo do agendador executado com sucesso',
        resultado,
      });
    });

    // Coletar dados brutos sob demanda para uma conexão (TASK-28)
    authApp.post('/conexoes/:id/coletar-raw', async (request, reply) => {
      const { id } = request.params as { id: string };
      const { openFinanceSchedulerService } = await import('./scheduler/open-finance-scheduler.service.js');

      try {
        const resultado = await openFinanceSchedulerService.coletarDadosBrutosConexao(id);
        return reply.send({
          message: 'Coleta bruta executada e persistida na tabela dados_brutos_open_finance',
          resultado,
        });
      } catch (err: unknown) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err instanceof Error ? err.message : 'Falha na coleta de dados brutos',
        });
      }
    });

    // Listar histórico de dados brutos coletados do usuário (TASK-28)
    authApp.get('/dados-brutos', async (request, reply) => {
      const usuarioId = request.user.sub;
      const { conexaoId, status } = request.query as { conexaoId?: string; status?: any };

      const { prisma } = await import('../../infrastructure/database/prisma.js');
      const dadosBrutos = await prisma.dadoBrutoOpenFinance.findMany({
        where: {
          usuarioId,
          ...(conexaoId ? { conexaoId } : {}),
          ...(status ? { status } : {}),
        },
        orderBy: { coletadoEm: 'desc' },
        take: 50,
        select: {
          id: true,
          conexaoId: true,
          instituicaoCodigo: true,
          tipoDado: true,
          hashCarga: true,
          status: true,
          mensagemErro: true,
          tentativas: true,
          coletadoEm: true,
          processadoEm: true,
        },
      });

      return reply.send({ dadosBrutos });
    });

    // Processar um registro de dado bruto específico sob demanda (TASK-29)
    authApp.post('/worker/processar/:id', async (request, reply) => {
      const usuarioId = request.user.sub;
      const { id } = request.params as { id: string };
      const { openFinanceWorkerService } = await import('./worker/open-finance-worker.service.js');

      try {
        const resultado = await openFinanceWorkerService.processarRegistroDadoBruto(id, usuarioId);
        return reply.send({
          message: 'Processamento do dado bruto executado',
          resultado,
        });
      } catch (err: unknown) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err instanceof Error ? err.message : 'Falha ao processar dado bruto',
        });
      }
    });

    // Executar sweep periódico de segurança do worker sob demanda (TASK-29)
    authApp.post('/worker/sweep', async (_request, reply) => {
      const { openFinanceWorkerService } = await import('./worker/open-finance-worker.service.js');
      const resultado = await openFinanceWorkerService.executarSweepSeguranca();
      return reply.send({
        message: 'Sweep de segurança executado com sucesso',
        resultado,
      });
    });

    // Reprocessar registros de Dead Letter Queue (DLQ) sob demanda (TASK-29)
    authApp.post('/worker/reprocessar-dlq', async (request, reply) => {
      const usuarioId = request.user.sub;
      const { dadoBrutoId } = (request.body as { dadoBrutoId?: string }) || {};
      const { openFinanceWorkerService } = await import('./worker/open-finance-worker.service.js');

      const resultados = await openFinanceWorkerService.reprocessarDLQ(dadoBrutoId, usuarioId);
      return reply.send({
        message: 'Reprocessamento de registros DLQ concluído',
        total: resultados.length,
        resultados,
      });
    });

    // Importar extrato direto para uma conta
    authApp.post('/importar-extrato', async (request, reply) => {
      const usuarioId = request.user.sub;
      const body = importStatementSchema.safeParse(request.body);

      if (!body.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Dados de importação inválidos',
          issues: body.error.issues,
        });
      }

      try {
        const resultado = await hubService.importStatement({
          usuarioId,
          contaId: body.data.contaId,
          content: body.data.content,
          filename: body.data.filename,
        });

        return reply.send({
          message: 'Extrato importado com sucesso via Hub',
          resultado,
        });
      } catch (err: unknown) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err instanceof Error ? err.message : 'Falha na importação do extrato',
        });
      }
    });
  });
};
