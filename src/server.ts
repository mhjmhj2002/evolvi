import { buildApp } from './app.js';
import { env } from './config/env.js';
import { openFinanceSchedulerService } from './modules/conector/scheduler/open-finance-scheduler.service.js';
import { openFinanceWorkerService } from './modules/conector/worker/open-finance-worker.service.js';
import { importacaoIaWorkerService } from './modules/importacao/worker/importacao-ia-worker.service.js';
import { importacaoStagingWorkerService } from './modules/importacao/worker/importacao-staging-worker.service.js';
import { importacaoConsolidacaoWorkerService } from './modules/importacao/worker/importacao-consolidacao-worker.service.js';

async function bootstrap() {
  const app = await buildApp();

  try {
    // Iniciar agendador de busca e workers de processamento em background
    openFinanceSchedulerService.start();
    openFinanceWorkerService.start();
    importacaoIaWorkerService.setupEventListener();
    importacaoStagingWorkerService.setupEventListener();
    importacaoConsolidacaoWorkerService.setupEventListener();

    await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`🚀 Servidor evolvi rodando em http://${env.HOST}:${env.PORT}`);
    console.log(`🩺 Health check disponível em http://${env.HOST}:${env.PORT}/health`);

    const gracefulShutdown = () => {
      console.log('🛑 Encerrando servidor, agendadores e workers...');
      openFinanceSchedulerService.stop();
      openFinanceWorkerService.stop();
      importacaoIaWorkerService.removeEventListener();
      importacaoStagingWorkerService.removeEventListener();
      importacaoConsolidacaoWorkerService.removeEventListener();
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

