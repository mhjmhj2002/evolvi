import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ensureAuthenticated } from '../../middlewares/auth.middleware.js';
import { alertaService } from './alerta.service.js';
import {
  criarAlertaSchema,
  queryAlertasSchema,
  atualizarStatusAlertaSchema,
  criarRegraAlertaSchema,
  atualizarRegraAlertaSchema,
} from './alerta.schema.js';

export const alertaRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addHook('preHandler', ensureAuthenticated);

  // ==========================================
  // ROTAS DO CRUD DE REGRAS DE ALERTA (Data-Driven)
  // ==========================================

  // GET /api/alertas/regras - Listar regras de alerta do usuário
  app.get('/regras', async (request, reply) => {
    const usuarioId = request.user.sub;
    const regras = await alertaService.listarRegras(usuarioId);
    return reply.status(200).send({ regras });
  });

  // POST /api/alertas/regras - Criar nova regra de alerta
  app.post('/regras', async (request, reply) => {
    const usuarioId = request.user.sub;
    const parseResult = criarRegraAlertaSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados inválidos para criação da regra de alerta',
        issues: parseResult.error.issues,
      });
    }

    try {
      const regra = await alertaService.criarRegra(usuarioId, parseResult.data);
      return reply.status(201).send({ regra });
    } catch (err: any) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: err.message || 'Erro ao criar regra de alerta',
      });
    }
  });

  // PUT /api/alertas/regras/:id - Atualizar regra de alerta (ativar/desativar, mudar parâmetros)
  app.put('/regras/:id', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params as { id: string };
    const parseResult = atualizarRegraAlertaSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados inválidos para atualização da regra',
        issues: parseResult.error.issues,
      });
    }

    try {
      const regra = await alertaService.atualizarRegra(usuarioId, id, parseResult.data);
      return reply.status(200).send({ regra });
    } catch (err: any) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: err.message || 'Regra não encontrada',
      });
    }
  });

  // DELETE /api/alertas/regras/:id - Excluir regra personalizada de alerta
  app.delete('/regras/:id', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params as { id: string };

    try {
      await alertaService.excluirRegra(usuarioId, id);
      return reply.status(200).send({ success: true });
    } catch (err: any) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: err.message || 'Regra não encontrada',
      });
    }
  });

  // ==========================================
  // ROTAS DE INSTÂNCIAS DE ALERTAS (Notificações)
  // ==========================================

  // GET /api/alertas - Listar alertas emitidos para o usuário
  app.get('/', async (request, reply) => {
    const usuarioId = request.user.sub;
    const query = queryAlertasSchema.safeParse(request.query);

    const alertas = await alertaService.listarAlertas(
      usuarioId,
      query.success ? query.data : undefined
    );

    return reply.status(200).send({ alertas });
  });

  // GET /api/alertas/resumo - Contagem e resumo de alertas pendentes
  app.get('/resumo', async (request, reply) => {
    const usuarioId = request.user.sub;
    const resumo = await alertaService.obterResumoAlertas(usuarioId);
    return reply.status(200).send(resumo);
  });

  // POST /api/alertas - Criar alerta genérico (instância)
  app.post('/', async (request, reply) => {
    const usuarioId = request.user.sub;
    const parseResult = criarAlertaSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados inválidos para criação do alerta',
        issues: parseResult.error.issues,
      });
    }

    const alerta = await alertaService.criarAlerta(usuarioId, parseResult.data);
    return reply.status(201).send({ alerta });
  });

  // PATCH /api/alertas/:id/status - Atualizar status do alerta (VISUALIZADO, CANCELADO, RESOLVIDO)
  app.patch('/:id/status', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params as { id: string };
    const parseResult = atualizarStatusAlertaSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Status de alerta inválido',
        issues: parseResult.error.issues,
      });
    }

    try {
      const alerta = await alertaService.atualizarStatus(usuarioId, id, parseResult.data);
      return reply.status(200).send({ alerta });
    } catch (err: any) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: err.message || 'Alerta não encontrado',
      });
    }
  });

  // POST /api/alertas/marcar-todos-visualizados - Marcar todos como visualizados
  app.post('/marcar-todos-visualizados', async (request, reply) => {
    const usuarioId = request.user.sub;
    const resultado = await alertaService.marcarTodosVisualizados(usuarioId);
    return reply.status(200).send(resultado);
  });

  // DELETE /api/alertas/:id - Excluir alerta
  app.delete('/:id', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params as { id: string };

    try {
      await alertaService.excluirAlerta(usuarioId, id);
      return reply.status(200).send({ success: true });
    } catch (err: any) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: err.message || 'Alerta não encontrado',
      });
    }
  });
};
