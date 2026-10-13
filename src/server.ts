import { buildApp } from './app.js';
import { env } from './config/env.js';
import { openFinanceSchedulerService } from './modules/conector/scheduler/open-finance-scheduler.service.js';
import { openFinanceWorkerService } from './modules/conector/worker/open-finance-worker.service.js';

async function bootstrap() {
  const app = await buildApp();

  try {
    // Iniciar agendador de busca e worker de conciliação de dados brutos em background
    openFinanceSchedulerService.start();
    openFinanceWorkerService.start();

    await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`🚀 Servidor evolvi rodando em http://${env.HOST}:${env.PORT}`);
    console.log(`🩺 Health check disponível em http://${env.HOST}:${env.PORT}/health`);

    const gracefulShutdown = () => {
      console.log('🛑 Encerrando servidor, agendadores e workers...');
      openFinanceSchedulerService.stop();
      openFinanceWorkerService.stop();
      app.close().then(() => {
        process.exit(0);
      });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
  } catch (err) {
    openFinanceSchedulerService.stop();
    app.log.error(err);
    process.exit(1);
  }
}

bootstrap();

