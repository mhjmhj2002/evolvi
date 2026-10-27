import { setupConsoleLogger } from './infrastructure/logger/logger.js';
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { openFinanceSchedulerService } from './modules/conector/scheduler/open-finance-scheduler.service.js';
import { openFinanceWorkerService } from './modules/conector/worker/open-finance-worker.service.js';
import { importacaoIaWorkerService } from './modules/importacao/worker/importacao-ia-worker.service.js';
import { importacaoStagingWorkerService } from './modules/importacao/worker/importacao-staging-worker.service.js';
import { importacaoConsolidacaoWorkerService } from './modules/importacao/worker/importacao-consolidacao-worker.service.js';
import { movimentoRecalculoWorkerService } from './modules/movimento/movimento-recalculo-worker.service.js';
import { validacaoDeduplicacaoWorkerService } from './modules/movimento/validacao-deduplicacao-worker.service.js';
import { faturaConciliacaoWorkerService } from './modules/movimento/fatura-conciliacao.service.js';
import { parcelamentoSincronizacaoWorkerService } from './modules/parcelamento/parcelamento-sincronizacao-worker.service.js';
import { iaMediasConsolidadasWorkerService } from './modules/ia/ia-medias-consolidadas.service.js';
import { mediaMensalWorkerService } from './modules/media-mensal/media-mensal-worker.service.js';

// Inicializa formatação padronizada de logs (data/hora yyyy-mm-dd-hh:mm:ss.sss e app de origem)
setupConsoleLogger('evolvi-backend');

async function bootstrap() {
  const app = await buildApp();

  try {
    // Iniciar agendador de busca e workers de processamento em background
    openFinanceSchedulerService.start();
    openFinanceWorkerService.start();
    importacaoIaWorkerService.setupEventListener();
    importacaoStagingWorkerService.setupEventListener();
    importacaoConsolidacaoWorkerService.setupEventListener();
    movimentoRecalculoWorkerService.setupEventListener();
    validacaoDeduplicacaoWorkerService.setupEventListener();
    faturaConciliacaoWorkerService.setupEventListener();
    parcelamentoSincronizacaoWorkerService.setupEventListener();
    iaMediasConsolidadasWorkerService.setupEventListener();
    mediaMensalWorkerService.setupEventListener();

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
      movimentoRecalculoWorkerService.removeEventListener();
      validacaoDeduplicacaoWorkerService.removeEventListener();
      faturaConciliacaoWorkerService.removeEventListener();
      parcelamentoSincronizacaoWorkerService.removeEventListener();
      iaMediasConsolidadasWorkerService.removeEventListener();
      mediaMensalWorkerService.removeEventListener();
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

