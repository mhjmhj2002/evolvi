import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../infrastructure/database/prisma.js';
import {
  IaMediasConsolidadasService,
  IaMediasConsolidadasWorkerService,
  iaMediasConsolidadasWorkerService,
} from './ia-medias-consolidadas.service.js';

describe('TASK-52: IaMediasConsolidadasService', () => {
  const usuarioTesteId = 'c0000000-0000-0000-0000-000000000052';

  beforeEach(async () => {
    // Limpa tabelas de teste
    await prisma.iaMediasConsolidadas.deleteMany({
      where: { provedor: { in: ['GEMINI', 'OPENROUTER', 'TEST_PROV'] } },
    });
    await prisma.usoIaLog.deleteMany({
      where: { usuarioId: usuarioTesteId },
    });
    await prisma.usuario.deleteMany({
      where: { id: usuarioTesteId },
    });

    await prisma.usuario.create({
      data: {
        id: usuarioTesteId,
        email: 'test_task52@evolvi.app',
        nome: 'Usuario TASK-52',
        senhaHash: 'hash-valido-1234567890',
      },
    });
  });

  it('deve retornar fallbacks com isEstimativa=true quando tabela estiver vazia', async () => {
    const medias = await IaMediasConsolidadasService.listarMediasConsolidadas();
    expect(medias.length).toBeGreaterThan(0);

    const geminiFlash = medias.find(
      (m) => m.provedor.toUpperCase() === 'GEMINI' && m.modelo.toLowerCase() === 'gemini-3.8-flash'
    );
    expect(geminiFlash).toBeDefined();
    expect(geminiFlash?.isEstimativa).toBe(true);
    expect(geminiFlash?.totalChamadas).toBe(0);
    expect(geminiFlash?.custoUsdPor1kTokens).toBeGreaterThan(0);
    expect(geminiFlash?.custoBrlPor1kTokens).toBeGreaterThan(0);
    expect(geminiFlash?.segundosPor1kTokens).toBeGreaterThan(0);
  });

  it('deve consolidar médias reais a partir de uso_ia_logs com sucesso e fazer upsert', async () => {
    // Insere 2 logs de sucesso para TEST_PROV / test-model
    await prisma.usoIaLog.create({
      data: {
        usuarioId: usuarioTesteId,
        provedor: 'TEST_PROV',
        modelo: 'test-model',
        funcionalidade: 'EXTRACAO_EXTRATO',
        tokensPrompt: 800,
        tokensResposta: 200,
        tokensTotal: 1000,
        custoUsd: 0.002, // 0.002 USD para 1k tokens = 0.002 USD/1k
        cotacaoUsdBrl: 5.5,
        duracaoMs: 1500, // 1.5s
        status: 'SUCESSO',
      },
    });

    await prisma.usoIaLog.create({
      data: {
        usuarioId: usuarioTesteId,
        provedor: 'TEST_PROV',
        modelo: 'test-model',
        funcionalidade: 'EXTRACAO_EXTRATO',
        tokensPrompt: 2400,
        tokensResposta: 600,
        tokensTotal: 3000,
        custoUsd: 0.006, // 0.006 USD para 3k tokens
        cotacaoUsdBrl: 5.5,
        duracaoMs: 2500, // 2.5s
        status: 'SUCESSO',
      },
    });

    // Insere 1 log de falha que deve ser desconsiderado na consolidação
    await prisma.usoIaLog.create({
      data: {
        usuarioId: usuarioTesteId,
        provedor: 'TEST_PROV',
        modelo: 'test-model',
        funcionalidade: 'EXTRACAO_EXTRATO',
        tokensPrompt: 500,
        tokensResposta: 0,
        tokensTotal: 500,
        custoUsd: 0,
        cotacaoUsdBrl: 5.5,
        duracaoMs: 500,
        status: 'FALHA',
      },
    });

    const processados = await IaMediasConsolidadasService.consolidarMediasGlobais();
    expect(processados).toBeGreaterThanOrEqual(1);

    // Consulta banco
    const consolidado = await prisma.iaMediasConsolidadas.findUnique({
      where: {
        provedor_modelo: {
          provedor: 'TEST_PROV',
          modelo: 'test-model',
        },
      },
    });

    expect(consolidado).toBeDefined();
    expect(consolidado?.totalChamadas).toBe(2);
    // Total tokens = 1000 + 3000 = 4000
    // Total custo = 0.002 + 0.006 = 0.008 USD -> (0.008 / 4000) * 1000 = 0.002 USD/1k
    expect(Number(consolidado?.custoUsdPor1kTokens)).toBeCloseTo(0.002, 5);
    // Total duracao = 1500ms + 2500ms = 4000ms = 4s -> (4 / 4000) * 1000 = 1.0s/1k
    expect(Number(consolidado?.segundosPor1kTokens)).toBeCloseTo(1.0, 2);

    // Teste de listagem com item real
    const medias = await IaMediasConsolidadasService.listarMediasConsolidadas();
    const item = medias.find(
      (m) => m.provedor === 'TEST_PROV' && m.modelo === 'test-model'
    );
    expect(item).toBeDefined();
    expect(item?.isEstimativa).toBe(false);
    expect(item?.totalChamadas).toBe(2);
    expect(item?.custoUsdPor1kTokens).toBeCloseTo(0.002, 5);
    expect(item?.custoBrlPor1kTokens).toBeCloseTo(0.002 * 5.5, 4);
    expect(item?.segundosPor1kTokens).toBeCloseTo(1.0, 2);
  });

  it('worker deve agendar consolidação sem bloquear a execução', async () => {
    const spy = vi.spyOn(IaMediasConsolidadasService, 'consolidarMediasGlobais');
    iaMediasConsolidadasWorkerService.agendarConsolidacao();

    // Aguarda o setImmediate
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
