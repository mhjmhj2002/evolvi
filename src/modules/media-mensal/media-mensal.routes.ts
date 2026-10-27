import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ensureAuthenticated } from '../../middlewares/auth.middleware.js';
import { mediaMensalService } from './media-mensal.service.js';
import { motorExclusaoMediaService } from './motor-exclusao-media.service.js';
import {
  criarRegraExclusaoMediaSchema,
  atualizarRegraExclusaoMediaSchema,
  criarExclusaoManualSchema,
  queryPesquisaLancamentosSchema,
  queryMediaMensalConsolidadaSchema,
} from './media-mensal.schema.js';

export const mediaMensalRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addHook('preHandler', ensureAuthenticated);

  // 1. GET /api/media-mensal/regras - Listar regras cadastradas
  app.get('/regras', async (request, reply) => {
    const usuarioId = request.user.sub;
    const regras = await mediaMensalService.listarRegras(usuarioId);
    return reply.status(200).send(regras);
  });

  // 2. POST /api/media-mensal/regras - Criar nova regra
  app.post('/regras', async (request, reply) => {
    const usuarioId = request.user.sub;
    const parsed = criarRegraExclusaoMediaSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados inválidos para criação da regra.',
        issues: parsed.error.issues,
      });
    }

    const regra = await mediaMensalService.criarRegra(usuarioId, parsed.data);
    return reply.status(201).send(regra);
  });

  // 3. PUT /api/media-mensal/regras/:id - Atualizar regra existente
  app.put<{ Params: { id: string } }>('/regras/:id', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params;
    const parsed = atualizarRegraExclusaoMediaSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados inválidos para atualização da regra.',
        issues: parsed.error.issues,
      });
    }

    try {
      const regra = await mediaMensalService.atualizarRegra(usuarioId, id, parsed.data);
      return reply.status(200).send(regra);
    } catch (err: any) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: err.message,
      });
    }
  });

  // 4. DELETE /api/media-mensal/regras/:id - Remover regra
  app.delete<{ Params: { id: string } }>('/regras/:id', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params;
    try {
      const res = await mediaMensalService.excluirRegra(usuarioId, id);
      return reply.status(200).send(res);
    } catch (err: any) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: err.message,
      });
    }
  });

  // 5. GET /api/media-mensal/exclusoes - Listar lançamentos desconsiderados
  app.get('/exclusoes', async (request, reply) => {
    const usuarioId = request.user.sub;
    const exclusoes = await mediaMensalService.listarExclusoes(usuarioId);
    return reply.status(200).send(exclusoes);
  });

  // 6. POST /api/media-mensal/exclusoes - Incluir lançamento na exclusão da média (manual)
  app.post('/exclusoes', async (request, reply) => {
    const usuarioId = request.user.sub;
    const parsed = criarExclusaoManualSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados inválidos para exclusão do lançamento da média.',
        issues: parsed.error.issues,
      });
    }

    try {
      const exclusao = await mediaMensalService.incluirExclusaoManual(
        usuarioId,
        parsed.data.movimentoId,
        parsed.data.motivo
      );
      return reply.status(201).send(exclusao);
    } catch (err: any) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: err.message,
      });
    }
  });

  // 7. PATCH /api/media-mensal/exclusoes/:id/status - Ativar ou inativar exclusão
  app.patch<{ Params: { id: string }; Body: { ativo: boolean } }>(
    '/exclusoes/:id/status',
    async (request, reply) => {
      const usuarioId = request.user.sub;
      const { id } = request.params;
      const ativo = request.body?.ativo !== false;

      try {
        const atualizado = await mediaMensalService.alternarStatusExclusao(
          usuarioId,
          id,
          ativo
        );
        return reply.status(200).send(atualizado);
      } catch (err: any) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: err.message,
        });
      }
    }
  );

  // 8. DELETE /api/media-mensal/exclusoes/:id - Remover exclusão (restaura lançamento para a média)
  app.delete<{ Params: { id: string } }>('/exclusoes/:id', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params;
    try {
      const res = await mediaMensalService.removerExclusao(usuarioId, id);
      return reply.status(200).send(res);
    } catch (err: any) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: err.message,
      });
    }
  });

  // 9. GET /api/media-mensal/pesquisa-lancamentos - Busca de lançamentos para inclusão na exclusão
  app.get('/pesquisa-lancamentos', async (request, reply) => {
    const usuarioId = request.user.sub;
    const parsed = queryPesquisaLancamentosSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Parâmetros de pesquisa inválidos.',
        issues: parsed.error.issues,
      });
    }

    const lancamentos = await mediaMensalService.pesquisarLancamentos(
      usuarioId,
      parsed.data
    );
    return reply.status(200).send(lancamentos);
  });

  // 10. GET /api/media-mensal/consolidado - Consultar tabela de médias consolidadas
  app.get('/consolidado', async (request, reply) => {
    const usuarioId = request.user.sub;
    const parsed = queryMediaMensalConsolidadaSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Parâmetros de consulta inválidos.',
        issues: parsed.error.issues,
      });
    }

    const consolidado = await mediaMensalService.obterMediasConsolidadas(
      usuarioId,
      parsed.data.competenciaReferencia,
      parsed.data.mesesJanela
    );
    return reply.status(200).send(consolidado);
  });

  // 11. POST /api/media-mensal/recalcular - Forçar recálculo e consolidação imediata
  app.post('/recalcular', async (request, reply) => {
    const usuarioId = request.user.sub;
    const resultado = await motorExclusaoMediaService.consolidarMedias(usuarioId);
    return reply.status(200).send({
      mensagem: 'Média recalculada e consolidada com sucesso.',
      resultado,
    });
  });
};
