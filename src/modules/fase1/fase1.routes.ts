import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ensureAuthenticated } from '../../middlewares/auth.middleware.js';
import { baselineService } from './baseline.service.js';
import { metasZeroAZeroService } from './metas.service.js';
import { historicoConsumoService } from './historico.service.js';
import { queryFase1HistoricoSchema } from './historico.schema.js';
import {
  queryFase1BaselineSchema,
  queryFase1MetasSchema,
  salvarMetasZeroAZeroSchema,
  queryFase1MetasExecucaoSchema,
} from './fase1.schema.js';
import { previsaoProjecaoService } from './previsao.service.js';
import {
  queryFase1PrevisaoSchema,
  queryDecomposicaoCategoriasSchema,
  updateVariavelAuditadaLoteSchema,
} from './previsao.schema.js';

export const fase1Routes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addHook('preHandler', ensureAuthenticated);

  // GET /api/fase1/baseline
  app.get('/baseline', async (request, reply) => {
    const usuarioId = request.user.sub;

    const queryParse = queryFase1BaselineSchema.safeParse(request.query);
    if (!queryParse.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Parâmetros de consulta inválidos.',
        issues: queryParse.error.issues,
      });
    }

    const { competenciaReferencia, mesesJanela } = queryParse.data;
    const resultado = await baselineService.calcularBaseline(
      usuarioId,
      competenciaReferencia,
      mesesJanela
    );

    return reply.status(200).send(resultado);
  });

  // GET /api/fase1/semaforo
  app.get('/semaforo', async (request, reply) => {
    const usuarioId = request.user.sub;

    const queryParse = queryFase1BaselineSchema.safeParse(request.query);
    if (!queryParse.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Parâmetros de consulta inválidos.',
        issues: queryParse.error.issues,
      });
    }

    const { competenciaReferencia, mesesJanela } = queryParse.data;
    const resultado = await baselineService.calcularSemaforo(
      usuarioId,
      competenciaReferencia,
      mesesJanela
    );

    return reply.status(200).send(resultado);
  });

  // GET /api/fase1/metas
  app.get('/metas', async (request, reply) => {
    const usuarioId = request.user.sub;

    const queryParse = queryFase1MetasSchema.safeParse(request.query);
    if (!queryParse.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Parâmetros de consulta inválidos.',
        issues: queryParse.error.issues,
      });
    }

    const { competencia } = queryParse.data;
    const resultado = await metasZeroAZeroService.obterMetas(usuarioId, competencia);

    return reply.status(200).send(resultado);
  });

  // POST /api/fase1/metas
  app.post('/metas', async (request, reply) => {
    const usuarioId = request.user.sub;

    const bodyParse = salvarMetasZeroAZeroSchema.safeParse(request.body);
    if (!bodyParse.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Corpo da requisição inválido para salvar metas.',
        issues: bodyParse.error.issues,
      });
    }

    try {
      const resultado = await metasZeroAZeroService.salvarMetas(usuarioId, bodyParse.data);
      return reply.status(200).send(resultado);
    } catch (err: any) {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: err.message || 'Erro ao processar e salvar metas do Zero a Zero.',
      });
    }
  });

  // GET /api/fase1/metas/execucao
  app.get('/metas/execucao', async (request, reply) => {
    const usuarioId = request.user.sub;

    const queryParse = queryFase1MetasExecucaoSchema.safeParse(request.query);
    if (!queryParse.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Parâmetros de consulta inválidos. A competência (YYYY-MM) é obrigatória.',
        issues: queryParse.error.issues,
      });
    }

    const { competencia } = queryParse.data;
    const resultado = await metasZeroAZeroService.obterExecucao(usuarioId, competencia);

    return reply.status(200).send(resultado);
  });

  // GET /api/fase1/historico/resumo (TASK-13 - M-004)
  app.get('/historico/resumo', async (request, reply) => {
    const usuarioId = request.user.sub;

    const queryParse = queryFase1HistoricoSchema.safeParse(request.query);
    if (!queryParse.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Parâmetros de consulta inválidos para o histórico.',
        issues: queryParse.error.issues,
      });
    }

    const { competenciaReferencia, mesesJanela } = queryParse.data;
    const resultado = await historicoConsumoService.obterResumoHistorico(
      usuarioId,
      competenciaReferencia,
      mesesJanela
    );

    return reply.status(200).send(resultado);
  });

  // GET /api/fase1/historico/categorias (TASK-13 - M-004)
  app.get('/historico/categorias', async (request, reply) => {
    const usuarioId = request.user.sub;

    const queryParse = queryFase1HistoricoSchema.safeParse(request.query);
    if (!queryParse.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Parâmetros de consulta inválidos para análise de categorias do histórico.',
        issues: queryParse.error.issues,
      });
    }

    const { competenciaReferencia, mesesJanela } = queryParse.data;
    const resultado = await historicoConsumoService.obterAnaliseCategorias(
      usuarioId,
      competenciaReferencia,
      mesesJanela
    );

    return reply.status(200).send(resultado);
  });

  // GET /api/fase1/previsao/seis-meses (TASK-14 - M-005)
  app.get('/previsao/seis-meses', async (request, reply) => {
    const usuarioId = request.user.sub;

    const queryParse = queryFase1PrevisaoSchema.safeParse(request.query);
    if (!queryParse.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Parâmetros de consulta inválidos para a projeção de 6 meses.',
        issues: queryParse.error.issues,
      });
    }

    const { competenciaReferencia, mesesProjecao } = queryParse.data;
    const resultado = await previsaoProjecaoService.calcularProjecaoSeisMeses(
      usuarioId,
      competenciaReferencia,
      mesesProjecao
    );

    return reply.status(200).send(resultado);
  });

  // GET /api/fase1/previsao/decomposicao-categorias (TASK-14 - M-005)
  app.get('/previsao/decomposicao-categorias', async (request, reply) => {
    const usuarioId = request.user.sub;

    const queryParse = queryDecomposicaoCategoriasSchema.safeParse(request.query);
    if (!queryParse.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Parâmetros de consulta inválidos. A competência (YYYY-MM) é obrigatória.',
        issues: queryParse.error.issues,
      });
    }

    const { competencia } = queryParse.data;
    const resultado = await previsaoProjecaoService.obterDecomposicaoCategorias(
      usuarioId,
      competencia
    );

    return reply.status(200).send(resultado);
  });

  // PUT /api/fase1/previsao/variavel-auditada (TASK-14 - M-005)
  app.put('/previsao/variavel-auditada', async (request, reply) => {
    const usuarioId = request.user.sub;

    const bodyParse = updateVariavelAuditadaLoteSchema.safeParse(request.body);
    if (!bodyParse.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Formato inválido para ajuste da camada variável.',
        issues: bodyParse.error.issues,
      });
    }

    const resultado = previsaoProjecaoService.ajustarVariavelAuditada(
      usuarioId,
      bodyParse.data.ajustes
    );

    return reply.status(200).send({
      mensagem: 'Calibração da camada variável atualizada com sucesso.',
      variavelAuditada: resultado,
    });
  });
};

