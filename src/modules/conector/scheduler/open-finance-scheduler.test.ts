import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../../app.js';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { openFinanceEventBus, OpenFinanceRawIngestedEvent } from '../../../infrastructure/events/open-finance-event-bus.js';
import { openFinanceSchedulerService } from './open-finance-scheduler.service.js';
import { BankConnectorFactory } from '../factory/bank-connector.factory.js';

describe('TASK-28: Agendamento Parametrizável (Scheduler) de Busca Open Finance e Ingestão Raw', () => {
  let app: FastifyInstance;
  let usuarioId: string;
  let token: string;
  let conexaoId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Limpar estado de testes anteriores
    const email = `sched-test-${Date.now()}@evolvi.app`;
    const cadRes = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Tester Scheduler Open Finance',
        email,
        senha: 'SenhaForte123!',
      },
    });

    const bodyCad = JSON.parse(cadRes.body);
    usuarioId = bodyCad.usuario.id;
    token = bodyCad.token;

    // Criar conexão bancária conectada com consentimento válido
    const connRes = await app.inject({
      method: 'POST',
      url: '/api/conectores/conexoes',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        instituicaoCodigo: 'CON-HUB',
        consentimentoConfirmado: true,
        escopo: ['contas', 'extratos'],
        credentials: {
          clientId: 'of-client-sched-test',
          certificadoThumbprint: 'thumbprint-valid-12345',
        },
      },
    });

    const connBody = JSON.parse(connRes.body);
    conexaoId = connBody.conexao.id;
  });

  afterAll(async () => {
    openFinanceSchedulerService.stop();
    if (usuarioId) {
      await prisma.dadoBrutoOpenFinance.deleteMany({ where: { usuarioId } });
      await prisma.conexaoBancaria.deleteMany({ where: { usuarioId } });
      await prisma.configuracaoUsuario.deleteMany({ where: { usuarioId } });
      await prisma.usuario.deleteMany({ where: { id: usuarioId } });
    }
    await app.close();
  });

  describe('1. Parametrização no Banco e API de Configuração (intervalo_sincronizacao_horas)', () => {
    it('deve permitir atualizar intervaloSincronizacaoHoras via PUT /api/usuario/configuracoes', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/usuario/configuracoes',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          intervaloSincronizacaoHoras: 12,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.intervaloSincronizacaoHoras).toBe(12);

      // Verificar persistência no banco
      const configBanco = await prisma.configuracaoUsuario.findUnique({
        where: { usuarioId },
      });
      expect(configBanco?.intervaloSincronizacaoHoras).toBe(12);
    });

    it('deve rejeitar intervaloSincronizacaoHoras fora dos limites 1h a 48h', async () => {
      const resMenor = await app.inject({
        method: 'PUT',
        url: '/api/usuario/configuracoes',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          intervaloSincronizacaoHoras: 0,
        },
      });
      expect(resMenor.statusCode).toBe(400);

      const resMaior = await app.inject({
        method: 'PUT',
        url: '/api/usuario/configuracoes',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          intervaloSincronizacaoHoras: 72,
        },
      });
      expect(resMaior.statusCode).toBe(400);
    });
  });

  describe('2. Identificação de Conexões Elegíveis', () => {
    it('deve identificar a conexão como elegível quando nunca sincronizada', async () => {
      // Forçar ultimaSincronizacaoEm para null
      await prisma.conexaoBancaria.update({
        where: { id: conexaoId },
        data: { ultimaSincronizacaoEm: null },
      });

      const elegiveis = await openFinanceSchedulerService.obterConexoesElegiveis();
      const encontrada = elegiveis.find((e) => e.conexao.id === conexaoId);

      expect(encontrada).toBeDefined();
      expect(encontrada?.intervaloHoras).toBe(12);
    });

    it('não deve considerar elegível se sincronizada recentemente dentro do intervalo', async () => {
      // Atualizar ultimaSincronizacaoEm para agora
      await prisma.conexaoBancaria.update({
        where: { id: conexaoId },
        data: { ultimaSincronizacaoEm: new Date() },
      });

      const elegiveis = await openFinanceSchedulerService.obterConexoesElegiveis();
      const encontrada = elegiveis.find((e) => e.conexao.id === conexaoId);

      expect(encontrada).toBeUndefined();
    });

    it('deve voltar a ser elegível quando última sincronização for mais antiga que o intervalo', async () => {
      // Definir data de 13 horas atrás (intervalo é 12h)
      const dataAntiga = new Date(Date.now() - 13 * 60 * 60 * 1000);
      await prisma.conexaoBancaria.update({
        where: { id: conexaoId },
        data: { ultimaSincronizacaoEm: dataAntiga },
      });

      const elegiveis = await openFinanceSchedulerService.obterConexoesElegiveis();
      const encontrada = elegiveis.find((e) => e.conexao.id === conexaoId);

      expect(encontrada).toBeDefined();
    });

    it('não deve sincronizar conexões revogadas ou com consentimento expirado', async () => {
      // Conexão revogada
      await prisma.conexaoBancaria.update({
        where: { id: conexaoId },
        data: { status: 'REVOGADO' },
      });

      let elegiveis = await openFinanceSchedulerService.obterConexoesElegiveis();
      expect(elegiveis.find((e) => e.conexao.id === conexaoId)).toBeUndefined();

      // Restaurar para conectado
      await prisma.conexaoBancaria.update({
        where: { id: conexaoId },
        data: { status: 'CONECTADO', consentimentoExpiraEm: new Date(Date.now() - 1000) },
      });

      // Consentimento no passado
      elegiveis = await openFinanceSchedulerService.obterConexoesElegiveis();
      expect(elegiveis.find((e) => e.conexao.id === conexaoId)).toBeUndefined();

      // Restaurar consentimento futuro
      await prisma.conexaoBancaria.update({
        where: { id: conexaoId },
        data: { consentimentoExpiraEm: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
      });
    });
  });

  describe('3. Ingestão Raw e Persistência em dados_brutos_open_finance', () => {
    it('deve coletar dados brutos e persistir com status PENDENTE_PROCESSAMENTO e hash determinístico', async () => {
      let eventoCapturado: OpenFinanceRawIngestedEvent | null = null;
      const listener = (evt: OpenFinanceRawIngestedEvent) => {
        if (evt.conexaoId === conexaoId) {
          eventoCapturado = evt;
        }
      };

      openFinanceEventBus.onRawIngested(listener);

      const resultado = await openFinanceSchedulerService.coletarDadosBrutosConexao(conexaoId);

      expect(resultado.dadosBrutosGerados).toBeGreaterThan(0);
      expect(resultado.dadosBrutosIds.length).toBeGreaterThan(0);
      expect(resultado.detalhes.contas).toBeGreaterThan(0);

      // Verificar persistência no banco na tabela dados_brutos_open_finance
      const registros = await prisma.dadoBrutoOpenFinance.findMany({
        where: { conexaoId },
      });

      expect(registros.length).toBe(resultado.dadosBrutosGerados);
      for (const reg of registros) {
        expect(reg.usuarioId).toBe(usuarioId);
        expect(reg.status).toBe('PENDENTE_PROCESSAMENTO');
        expect(reg.hashCarga).toHaveLength(64);
        expect(reg.payloadRaw).toBeDefined();
        expect(reg.tentativas).toBe(0);
      }

      // Verificar emissão do evento / ping reativo
      expect(eventoCapturado).toBeDefined();
      expect(eventoCapturado!.usuarioId).toBe(usuarioId);
      expect(eventoCapturado!.conexaoId).toBe(conexaoId);
      expect(eventoCapturado!.dadosBrutosIds).toEqual(resultado.dadosBrutosIds);

      openFinanceEventBus.removeListener('open_finance:raw_ingested', listener);
    });

    it('deve garantir idempotência via hashCarga sem duplicar registros brutos idênticos', async () => {
      const qtdAntes = await prisma.dadoBrutoOpenFinance.count({
        where: { conexaoId },
      });

      // Segunda coleta consecutiva para o mesmo mock (mesmos dados)
      const resultado2 = await openFinanceSchedulerService.coletarDadosBrutosConexao(conexaoId);

      const qtdDepois = await prisma.dadoBrutoOpenFinance.count({
        where: { conexaoId },
      });

      expect(qtdDepois).toBe(qtdAntes);
    });
  });

  describe('4. Endpoints REST do Scheduler e Consulta de Dados Brutos', () => {
    it('deve listar dados brutos coletados via GET /api/conectores/dados-brutos', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/conectores/dados-brutos',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(Array.isArray(data.dadosBrutos)).toBe(true);
      expect(data.dadosBrutos.length).toBeGreaterThan(0);

      const item = data.dadosBrutos[0];
      expect(item.conexaoId).toBe(conexaoId);
      expect(item.status).toBe('PENDENTE_PROCESSAMENTO');
      expect(item.hashCarga).toBeDefined();
    });

    it('deve executar coleta bruta sob demanda via POST /api/conectores/conexoes/:id/coletar-raw', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/conectores/conexoes/${conexaoId}/coletar-raw`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.message).toContain('persistida na tabela dados_brutos_open_finance');
      expect(data.resultado.conexaoId).toBe(conexaoId);
    });

    it('deve disparar ciclo do scheduler via POST /api/conectores/scheduler/executar', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/conectores/scheduler/executar',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.resultado.jobId).toBeDefined();
      expect(data.resultado.duracaoMs).toBeGreaterThanOrEqual(0);
    });
  });
});
