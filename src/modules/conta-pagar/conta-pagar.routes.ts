import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ensureAuthenticated } from '../../middlewares/auth.middleware.js';
import { contaPagarService } from './conta-pagar.service.js';
import {
  criarContaPagarSchema,
  atualizarContaPagarSchema,
  queryContasPagarSchema,
} from './conta-pagar.schema.js';

export const contaPagarRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addHook('preHandler', ensureAuthenticated);

  // GET /api/contas-pagar - Listar contas a pagar
  app.get('/', async (request, reply) => {
    const usuarioId = request.user.sub;
    const query = queryContasPagarSchema.safeParse(request.query);

    const contas = await contaPagarService.listar(
      usuarioId,
      query.success ? query.data : undefined
    );

    return reply.status(200).send({ contas });
  });

  // GET /api/contas-pagar/:id - Obter conta a pagar
  app.get('/:id', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params as { id: string };

    try {
      const conta = await contaPagarService.obterPorId(usuarioId, id);
      return reply.status(200).send({ conta });
    } catch (err: any) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: err.message || 'Conta a pagar não encontrada',
      });
    }
  });

  // POST /api/contas-pagar - Criar conta a pagar
  app.post('/', async (request, reply) => {
    const usuarioId = request.user.sub;
    const parseResult = criarContaPagarSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados inválidos para conta a pagar',
        issues: parseResult.error.issues,
      });
    }

    const conta = await contaPagarService.criar(usuarioId, parseResult.data);
    return reply.status(201).send({ conta });
  });

  // PUT /api/contas-pagar/:id - Atualizar conta a pagar
  app.put('/:id', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params as { id: string };
    const parseResult = atualizarContaPagarSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados inválidos para atualização',
        issues: parseResult.error.issues,
      });
    }

    try {
      const conta = await contaPagarService.atualizar(usuarioId, id, parseResult.data);
      return reply.status(200).send({ conta });
    } catch (err: any) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: err.message || 'Conta a pagar não encontrada',
      });
    }
  });

  // POST /api/contas-pagar/sincronizar-recorrencias - Importa compromissos recorrentes sem duplicar
  app.post('/sincronizar-recorrencias', async (request, reply) => {
    const usuarioId = request.user.sub;
    try {
      const resultado = await contaPagarService.sincronizarRecorrencias(usuarioId);
      return reply.status(200).send(resultado);
    } catch (err: any) {
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: err.message || 'Erro ao sincronizar recorrências',
      });
    }
  });

  // POST /api/contas-pagar/verificar-ciclo-mensal - Valida virada de mês manualmente ou sob demanda
  app.post('/verificar-ciclo-mensal', async (request, reply) => {
    const usuarioId = request.user.sub;
    try {
      const resultado = await contaPagarService.verificarERenovarCicloMensal(usuarioId);
      return reply.status(200).send(resultado);
    } catch (err: any) {
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: err.message || 'Erro ao validar ciclo mensal de contas',
      });
    }
  });

  // DELETE /api/contas-pagar/:id - Excluir conta a pagar
  app.delete('/:id', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { id } = request.params as { id: string };

    try {
      await contaPagarService.excluir(usuarioId, id);
      return reply.status(200).send({ success: true });
    } catch (err: any) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: err.message || 'Conta a pagar não encontrada',
      });
    }
  });
};

