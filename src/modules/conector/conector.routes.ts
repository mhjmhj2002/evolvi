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
  app.get('/instituicoes', async (_request, reply) => {
    const instituicoes = hubService.listInstitutions();
    return reply.send({ instituicoes });
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

    // Desconectar / Revogar
    authApp.delete('/conexoes/:id', async (request, reply) => {
      const usuarioId = request.user.sub;
      const { id } = request.params as { id: string };

      try {
        const conexao = await hubService.disconnect({ usuarioId, conexaoId: id });
        return reply.send({ message: 'Conexão revogada com sucesso', conexao });
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
