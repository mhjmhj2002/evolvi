import { afterAll, describe, expect, it } from 'vitest';
import { prisma, reiniciarContadorConsultas, obterContadorConsultas } from '../../../infrastructure/database/prisma.js';
import { ImportacaoStorageService } from '../importacao-storage.service.js';
import { ImportacaoConsolidacaoWorkerService } from './importacao-consolidacao-worker.service.js';

const habilitado = process.env.RUN_TASK60_BENCHMARK === '1' && process.env.EVOLVI_MEDIR_CONSULTAS === '1';
const service = new ImportacaoStorageService();
const volumesBenchmark = process.env.TASK60_BENCHMARK_VOLUMES
  ? process.env.TASK60_BENCHMARK_VOLUMES.split(',').map((valor) => Number(valor.trim())).filter((valor) => Number.isInteger(valor) && valor > 0)
  : [50, 500, 5000];

describe.skipIf(!habilitado)('TASK-60 benchmark paginado', () => {
  let usuarioId: string;
  const pastas: string[] = [];

  afterAll(async () => {
    if (usuarioId) await prisma.usuario.delete({ where: { id: usuarioId } });
    const fs = await import('node:fs/promises');
    for (const pasta of pastas) await fs.rm(pasta, { recursive: true, force: true }).catch(() => {});
  });

  it('processa os três volumes com contagem de queries, tempo e pico RSS', async () => {
    const usuario = await prisma.usuario.create({ data: { nome: 'Benchmark TASK-60', email: `task60-bench-${Date.now()}@evolvi.app`, senhaHash: 'benchmark-only' } });
    usuarioId = usuario.id;
    await prisma.conta.create({ data: { usuarioId, nome: 'Conta benchmark', tipo: 'CONTA_CORRENTE' } });

    for (const total of volumesBenchmark) {
      const lote = await service.recepcionarLote({ usuarioId, arquivos: [{ nomeOriginal: `benchmark-${total}.csv`, buffer: Buffer.from('fixture'), mimeType: 'text/csv' }] });
      pastas.push(lote.caminhoDiretorio);
      const arquivo = lote.arquivos[0];
      await prisma.arquivoImportacao.update({ where: { id: arquivo.id }, data: { hashConteudo: null } });
      for (let inicio = 0; inicio < total; inicio += 500) {
        const tamanho = Math.min(500, total - inicio);
        await prisma.stagingLancamentoImportacao.createMany({ data: Array.from({ length: tamanho }, (_, indice) => {
          const n = inicio + indice;
          return { loteId: lote.loteId, arquivoId: arquivo.id, arquivoOrigem: arquivo.nomeArquivo,
            dataMovimento: new Date('2026-10-01T00:00:00.000Z'), descricao: `Lançamento benchmark ${total} ${n}`,
            valor: n + 1, natureza: 'DESPESA', contaSugerida: 'Conta benchmark', tipoConta: 'CONTA_CORRENTE',
            statusProcessamento: 'PENDENTE' as const };
        }) });
      }

      (globalThis as any).gc?.();
      const rssInicial = process.memoryUsage().rss;
      let picoRss = rssInicial;
      const monitor = setInterval(() => { picoRss = Math.max(picoRss, process.memoryUsage().rss); }, 5);
      reiniciarContadorConsultas();
      const inicioMs = performance.now();
      const resultado = await new ImportacaoConsolidacaoWorkerService().consolidarLote(lote.loteId, usuarioId);
      const duracaoMs = performance.now() - inicioMs;
      picoRss = Math.max(picoRss, process.memoryUsage().rss);
      clearInterval(monitor);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const metricas = { linhas: total, inseridos: resultado.novosMovimentosInseridos, erros: resultado.erros.length, duracaoMs: Math.round(duracaoMs), consultas: obterContadorConsultas(), consultasPorLinha: Number((obterContadorConsultas() / total).toFixed(3)), aumentoRssBytes: Math.max(0, picoRss - rssInicial) };
      const fs = await import('node:fs/promises');
      await fs.appendFile('/tmp/task60-benchmark-results.jsonl', `${JSON.stringify(metricas)}\n`);
      console.info('[TASK-60 benchmark]', JSON.stringify(metricas));
      expect(resultado.sucesso).toBe(true);
      expect(resultado.novosMovimentosInseridos).toBe(total);
    }
  }, 180_000);
});
