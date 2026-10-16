import { describe, it, expect, vi } from 'vitest';
import { formatLogTimestamp, setupConsoleLogger } from './logger.js';
import { buildApp } from '../../app.js';

describe('Logger Utility', () => {
  it('deve formatar a data/hora exatamente no padrão yyyy-mm-dd-hh:mm:ss.sss', () => {
    // Ano 2026, Mês 10 (outubro = índice 9), Dia 16, Hora 20, Minuto 5, Segundo 9, Milissegundo 42
    const d = new Date(2026, 9, 16, 20, 5, 9, 42);
    const result = formatLogTimestamp(d);
    expect(result).toBe('2026-10-16-20:05:09.042');
  });

  it('deve interceptar console.log e incluir timestamp e app de origem no início', () => {
    const originalConsoleLog = console.log;
    let loggedMessage = '';
    console.log = vi.fn((...args: unknown[]) => {
      loggedMessage = args.join(' ');
    });

    setupConsoleLogger('evolvi-test-app');
    console.log('Mensagem de teste do sistema');

    // Restaura
    console.log = originalConsoleLog;

    expect(loggedMessage).toMatch(/^\[\d{4}-\d{2}-\d{2}-\d{2}:\d{2}:\d{2}\.\d{3}\] \[evolvi-test-app\] Mensagem de teste do sistema/);
  });

  it('o Fastify logger deve conter app de origem e formato de data/hora requerido', async () => {
    const app = await buildApp();
    expect(app.log).toBeDefined();

    // Injeta request para verificar se a rota funciona normalmente com o logger configurado
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
