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
import { limpezaUploadsLoginWorkerService } from './modules/importacao/worker/limpeza-uploads-login-worker.service.js';
import { recorrenciaSincronizacaoWorkerService } from './modules/recorrencia/recorrencia-sincronizacao-worker.service.js';
import { alertaContasVencerWorkerService } from './modules/alerta/worker/alerta-contas-vencer-worker.service.js';
import { prisma } from './infrastructure/database/prisma.js';

// Inicializa formatação padronizada de logs (data/hora yyyy-mm-dd-hh:mm:ss.sss e app de origem)
setupConsoleLogger('evolvi-backend');

async function bootstrap() {
  const app = await buildApp();

  try {
    // Iniciar agendador de busca e workers de processamento em background
    openFinanceSchedulerService.start();
    openFinanceWorkerService.start();
    alertaContasVencerWorkerService.startSweep();
    alertaContasVencerWorkerService.setupEventListener();
    importacaoIaWorkerService.setupEventListener();
    importacaoStagingWorkerService.setupEventListener();
    importacaoConsolidacaoWorkerService.setupEventListener();
    // O event bus acelera o fluxo normal; varreduras periódicas retomam etapas
    // que ficaram pendentes após reinício ou perda de evento.
    let recuperacaoImportacoesAtiva = false;
    const recuperarImportacoes = async () => {
      if (recuperacaoImportacoesAtiva) return;
      recuperacaoImportacoesAtiva = true;
      try {
        const iaPendentes = await prisma.arquivoImportacao.findMany({
          where: { status: { in: ['RECEPCIONADO', 'ENVIADO_IA'] }, jaImportadoAnteriormente: false,
            OR: [{ workerLeaseUntil: null }, { workerLeaseUntil: { lt: new Date() } }] },
          select: { loteId: true }, distinct: ['loteId'], take: 50, orderBy: { criadoEm: 'asc' },
        });
        for (const item of iaPendentes) {
          void importacaoIaWorkerService.processarLote(item.loteId).catch((err) => console.error('[recuperacao-importacao] IA:', err));
        }
        const stagingPendentes = await prisma.arquivoImportacao.findMany({
          where: { status: 'IA_CONCLUIDO', OR: [{ workerLeaseUntil: null }, { workerLeaseUntil: { lt: new Date() } }] },
          select: { id: true, lote: { select: { usuarioId: true } } },
          take: 50, orderBy: { criadoEm: 'asc' },
        });
        for (const item of stagingPendentes) {
          void importacaoStagingWorkerService.carregarArquivoParaStaging(item.id, item.lote.usuarioId)
            .catch((err) => console.error('[recuperacao-importacao] staging:', err));
        }
        const lotesStaging = await prisma.stagingLancamentoImportacao.findMany({
          where: { statusProcessamento: 'PENDENTE' }, select: { loteId: true }, distinct: ['loteId'], take: 50,
        });
        for (const item of lotesStaging) {
          const lote = await prisma.loteImportacao.findUnique({ where: { id: item.loteId }, select: { usuarioId: true } });
          if (lote) void importacaoConsolidacaoWorkerService.consolidarLote(item.loteId, lote.usuarioId)
            .catch((err) => console.error('[recuperacao-importacao] consolidação:', err));
        }
      } catch (err) {
        console.error('[recuperacao-importacao] Falha na varredura:', err);
      } finally {
        recuperacaoImportacoesAtiva = false;
      }
    };
    void recuperarImportacoes();
    const timerRecuperacaoImportacoes = setInterval(recuperarImportacoes, 30_000);
    movimentoRecalculoWorkerService.setupEventListener();
    validacaoDeduplicacaoWorkerService.setupEventListener();
    faturaConciliacaoWorkerService.setupEventListener();
    parcelamentoSincronizacaoWorkerService.setupEventListener();
    recorrenciaSincronizacaoWorkerService.setupEventListener();
    iaMediasConsolidadasWorkerService.setupEventListener();
    mediaMensalWorkerService.setupEventListener();
    limpezaUploadsLoginWorkerService.setupEventListener();

    await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`🚀 Servidor evolvi rodando em http://${env.HOST}:${env.PORT}`);
    console.log(`🩺 Health check disponível em http://${env.HOST}:${env.PORT}/health`);

    const gracefulShutdown = () => {
      console.log('🛑 Encerrando servidor, agendadores e workers...');
      openFinanceSchedulerService.stop();
      openFinanceWorkerService.stop();
      alertaContasVencerWorkerService.removeEventListener();
      importacaoIaWorkerService.removeEventListener();
      importacaoStagingWorkerService.removeEventListener();
      importacaoConsolidacaoWorkerService.removeEventListener();
      clearInterval(timerRecuperacaoImportacoes);
      movimentoRecalculoWorkerService.removeEventListener();
      validacaoDeduplicacaoWorkerService.removeEventListener();
      faturaConciliacaoWorkerService.removeEventListener();
      parcelamentoSincronizacaoWorkerService.removeEventListener();
      recorrenciaSincronizacaoWorkerService.removeEventListener();
      iaMediasConsolidadasWorkerService.removeEventListener();
      mediaMensalWorkerService.removeEventListener();
      limpezaUploadsLoginWorkerService.removeEventListener();
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

