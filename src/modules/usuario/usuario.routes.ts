import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ensureAuthenticated } from '../../middlewares/auth.middleware.js';
import { updateRendaBaseSchema } from '../auth/auth.schema.js';
import { calcularUltimosMesesFechados } from '../fase1/baseline.service.js';
import { configuracaoService } from './configuracao.service.js';
import { updateConfiguracaoUsuarioSchema } from './usuario.schema.js';

export const usuarioRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Proteger todas as rotas deste prefixo
  app.addHook('preHandler', ensureAuthenticated);

  // GET /api/usuario/perfil
  app.get('/perfil', async (request, reply) => {
    const usuarioId = request.user.sub;

    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        rendaBaseMensal: true,
        faseAtual: true,
        criadoEm: true,
        atualizadoEm: true,
      },
    });

    if (!usuario) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Usuário não encontrado.',
      });
    }

    const mesesJanela = await configuracaoService.obterMesesJanelaUsuario(usuarioId);

    return reply.status(200).send({
      usuario: {
        ...usuario,
        rendaBaseMensal: Number(usuario.rendaBaseMensal),
        mesesJanelaTemporal: mesesJanela,
      },
    });
  });

  // GET /api/usuario/configuracoes (TASK-27)
  app.get('/configuracoes', async (request, reply) => {
    const usuarioId = request.user.sub;
    const configuracao = await configuracaoService.obterConfiguracao(usuarioId);
    return reply.status(200).send(configuracao);
  });

  // PUT /api/usuario/configuracoes (TASK-27)
  app.put('/configuracoes', async (request, reply) => {
    const usuarioId = request.user.sub;

    const parseResult = updateConfiguracaoUsuarioSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Parâmetro de janela temporal inválido. Deve ser um número inteiro entre 3 e 12 meses.',
        issues: parseResult.error.issues,
      });
    }

    const { mesesJanelaTemporal } = parseResult.data;
    const resultado = await configuracaoService.atualizarConfiguracao(usuarioId, mesesJanelaTemporal);

    return reply.status(200).send({
      message: 'Configuração atualizada com sucesso.',
      ...resultado,
    });
  });

  // GET /api/usuario/renda-media-6m (ou média N-meses da janela configurada)
  app.get('/renda-media-6m', async (request, reply) => {
    const usuarioId = request.user.sub;
    const { competencia, meses } = request.query as { competencia?: string; meses?: string };

    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { rendaBaseMensal: true },
    });

    if (!usuario) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Usuário não encontrado.',
      });
    }

    // Se fornecido parâmetro explícito de meses, usa-o; caso contrário, busca a janela configurada do usuário (default 6)
    const mesesJanelaParam = meses ? parseInt(meses, 10) : undefined;
    const nMesesEfetivo =
      mesesJanelaParam && mesesJanelaParam >= 3 && mesesJanelaParam <= 12
        ? mesesJanelaParam
        : await configuracaoService.obterMesesJanelaUsuario(usuarioId);

    const mesesFechados = calcularUltimosMesesFechados(competencia, nMesesEfetivo);

    // Buscar movimentos de receitas operacionais líquidas conciliadas nos meses fechados
    // Expurgando transferências entre contas próprias e qualquer despesa
    const receitasFechadas = await prisma.movimento.findMany({
      where: {
        usuarioId,
        competencia: { in: mesesFechados },
        status: 'CONCILIADO',
        natureza: 'RECEITA',
      },
      select: {
        competencia: true,
        valor: true,
      },
    });

    const totaisPorMes: Record<string, number> = {};
    for (const m of mesesFechados) {
      totaisPorMes[m] = 0;
    }

    let totalReceitas = 0;
    for (const rec of receitasFechadas) {
      const val = Number(rec.valor);
      totalReceitas += val;
      if (totaisPorMes[rec.competencia] !== undefined) {
        totaisPorMes[rec.competencia] = Number((totaisPorMes[rec.competencia] + val).toFixed(2));
      }
    }

    const nMeses = mesesFechados.length || nMesesEfetivo;
    const media6m = Number((totalReceitas / nMeses).toFixed(2));
    const rendaAtual = Number(usuario.rendaBaseMensal);
    const complementoSugerido = Number((rendaAtual - media6m).toFixed(2));

    return reply.status(200).send({
      media6m,
      mesesJanela: nMesesEfetivo,
      totalReceitas: Number(totalReceitas.toFixed(2)),
      mesesFechados,
      totaisPorMes,
      rendaAtual,
      complementoSugerido,
    });
  });

  // PUT /api/usuario/renda-base
  app.put('/renda-base', async (request, reply) => {
    const usuarioId = request.user.sub;

    const parseResult = updateRendaBaseSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Valor de renda base inválido',
        issues: parseResult.error.issues,
      });
    }

    const { rendaBaseMensal } = parseResult.data;

    const usuarioAtualizado = await prisma.usuario.update({
      where: { id: usuarioId },
      data: {
        rendaBaseMensal,
      },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        rendaBaseMensal: true,
        faseAtual: true,
        atualizadoEm: true,
      },
    });

    return reply.status(200).send({
      message: 'Renda base atualizada com sucesso.',
      usuario: {
        ...usuarioAtualizado,
        rendaBaseMensal: Number(usuarioAtualizado.rendaBaseMensal),
      },
    });
  });
};
