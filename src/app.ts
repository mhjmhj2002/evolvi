import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { env } from './config/env.js';
import { formatLogTimestamp } from './infrastructure/logger/logger.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      base: {
        app: 'evolvi-backend',
      },
      timestamp: () => `,"time":"${formatLogTimestamp()}"`,
    },
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
    credentials: true,
  });

  await app.register(cookie);

  await app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: {
      cookieName: 'token',
      signed: false,
    },
  });

  // Parser flexível para application/json: permite corpo vazio sem disparar FST_ERR_CTP_EMPTY_JSON_BODY (ex: DELETE/GET)
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body || (typeof body === 'string' && body.trim() === '')) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // Healthcheck
  app.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
    };
  });

  // Módulos da aplicação
  const { authRoutes } = await import('./modules/auth/auth.routes.js');
  const { usuarioRoutes } = await import('./modules/usuario/usuario.routes.js');
  const { contaRoutes } = await import('./modules/conta/conta.routes.js');
  const { categoriaRoutes } = await import('./modules/categoria/categoria.routes.js');
  const { movimentoRoutes } = await import('./modules/movimento/movimento.routes.js');
  const { recorrenciaRoutes } = await import('./modules/recorrencia/recorrencia.routes.js');
  const { parcelamentoRoutes } = await import('./modules/parcelamento/parcelamento.routes.js');
  const { compromissoRoutes } = await import('./modules/compromisso/compromisso.routes.js');
  const { fase1Routes } = await import('./modules/fase1/fase1.routes.js');
  const { iaRoutes } = await import('./modules/ia/ia.routes.js');
  const { conectorRoutes } = await import('./modules/conector/conector.routes.js');
  const { importacaoRoutes } = await import('./modules/importacao/importacao.routes.js');
  const { investimentoRoutes } = await import('./modules/investimento/investimento.routes.js');
  const { mediaMensalRoutes } = await import('./modules/media-mensal/media-mensal.routes.js');

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(usuarioRoutes, { prefix: '/api/usuario' });
  await app.register(contaRoutes, { prefix: '/api/contas' });
  await app.register(categoriaRoutes, { prefix: '/api/categorias' });
  await app.register(movimentoRoutes, { prefix: '/api/movimentos' });
  await app.register(recorrenciaRoutes, { prefix: '/api/recorrencias' });
  await app.register(parcelamentoRoutes, { prefix: '/api/parcelamentos' });
  await app.register(compromissoRoutes, { prefix: '/api/compromissos' });
  await app.register(fase1Routes, { prefix: '/api/fase1' });
  await app.register(iaRoutes, { prefix: '/api/ia' });
  await app.register(conectorRoutes, { prefix: '/api/conectores' });
  await app.register(importacaoRoutes, { prefix: '/api/importacao' });
  await app.register(investimentoRoutes, { prefix: '/api/investimentos' });
  await app.register(mediaMensalRoutes, { prefix: '/api/media-mensal' });

  return app;
}

