import { buildApp } from './app.js';
import { env } from './config/env.js';

async function bootstrap() {
  const app = await buildApp();

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`🚀 Servidor evolvi rodando em http://${env.HOST}:${env.PORT}`);
    console.log(`🩺 Health check disponível em http://${env.HOST}:${env.PORT}/health`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

bootstrap();
