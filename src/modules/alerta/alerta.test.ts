import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { alertaContasVencerWorkerService } from './worker/alerta-contas-vencer-worker.service.js';

describe('Módulo de Alertas Data-Driven e Regras Configuráveis', () => {
  let app: FastifyInstance;
  let tokenUser1: string;
  let user1Id: string;
  let tokenUser2: string;
  let user2Id: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Criar Usuário 1
    const resUser1 = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario Alertas DataDriven 1',
        email: `datadriven1_${Date.now()}@teste.com`,
        senha: 'SenhaSegura123!',
      },
    });
    const data1 = JSON.parse(resUser1.payload);
    user1Id = data1.usuario.id;
    tokenUser1 = data1.token;

    // 2. Criar Usuário 2 para teste de isolamento multi-tenant
    const resUser2 = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario Alertas DataDriven 2',
        email: `datadriven2_${Date.now()}@teste.com`,
        senha: 'SenhaSegura123!',
      },
    });
    const data2 = JSON.parse(resUser2.payload);
    user2Id = data2.usuario.id;
    tokenUser2 = data2.token;
  });

  afterAll(async () => {
    await prisma.alertaSistema.deleteMany({
      where: { usuarioId: { in: [user1Id, user2Id] } },
    });
    await prisma.regraAlerta.deleteMany({
      where: { usuarioId: { in: [user1Id, user2Id] } },
    });
    await prisma.contaPagar.deleteMany({
      where: { usuarioId: { in: [user1Id, user2Id] } },
    });
    await prisma.usuario.deleteMany({
      where: { id: { in: [user1Id, user2Id] } },
    });
    await app.close();
  });

  describe('1. CRUD de Regras de Alerta Orientado a Dados (/api/alertas/regras)', () => {
    let regraCriadaId: string;

    it('deve listar regras padrão criadas automaticamente para o usuário', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/alertas/regras',
        headers: { authorization: `Bearer ${tokenUser1}` },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.regras.length).toBeGreaterThanOrEqual(3);
      expect(data.regras.some((r: any) => r.codigo === 'CONTA_A_VENCER')).toBe(true);
      expect(data.regras.some((r: any) => r.codigo === 'IMPORTACAO_PENDENTE_MES')).toBe(true);
    });

    it('deve permitir criar uma nova regra customizada sem alterar código backend', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/alertas/regras',
        headers: { authorization: `Bearer ${tokenUser1}` },
        payload: {
          codigo: 'META_RESERVA_EMERGENCIA',
          nome: 'Alerta de Reserva de Emergência Baixa',
          descricao: 'Notifica se a reserva líquida estiver abaixo de 3 meses de gastos',
          tipoGatilho: 'VERIFICACAO_DIARIA',
          severidadePadrao: 'ATENCAO',
          ativo: true,
          parametros: { mesesMinimos: 3, valorAlvo: 15000 },
          templateTitulo: 'Reserva abaixo da meta',
          templateMensagem: 'Sua reserva está em {{meses}} meses.',
        },
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.payload);
      expect(data.regra.codigo).toBe('META_RESERVA_EMERGENCIA');
      expect(data.regra.parametros.mesesMinimos).toBe(3);
      regraCriadaId = data.regra.id;
    });

    it('não deve permitir que o usuário 2 edite ou exclua a regra do usuário 1', async () => {
      const resPut = await app.inject({
        method: 'PUT',
        url: `/api/alertas/regras/${regraCriadaId}`,
        headers: { authorization: `Bearer ${tokenUser2}` },
        payload: { ativo: false },
      });
      expect(resPut.statusCode).toBe(404);

      const resDel = await app.inject({
        method: 'DELETE',
        url: `/api/alertas/regras/${regraCriadaId}`,
        headers: { authorization: `Bearer ${tokenUser2}` },
      });
      expect(resDel.statusCode).toBe(404);
    });

    it('deve atualizar parâmetros e status ativo da regra dinamicamente', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/alertas/regras/${regraCriadaId}`,
        headers: { authorization: `Bearer ${tokenUser1}` },
        payload: {
          ativo: false,
          parametros: { mesesMinimos: 6, valorAlvo: 30000 },
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.regra.ativo).toBe(false);
      expect(data.regra.parametros.mesesMinimos).toBe(6);
    });
  });

  describe('2. Worker Data-Driven e Respeito aos Parâmetros das Regras', () => {
    it('deve respeitar a antecedência de dias configurada na regra CONTA_A_VENCER', async () => {
      // 1. Obter a regra CONTA_A_VENCER do usuário 1 e alterar para 7 dias
      const resList = await app.inject({
        method: 'GET',
        url: '/api/alertas/regras',
        headers: { authorization: `Bearer ${tokenUser1}` },
      });
      const regraVencer = JSON.parse(resList.payload).regras.find(
        (r: any) => r.codigo === 'CONTA_A_VENCER'
      );

      await app.inject({
        method: 'PUT',
        url: `/api/alertas/regras/${regraVencer.id}`,
        headers: { authorization: `Bearer ${tokenUser1}` },
        payload: {
          parametros: { diasAntecedencia: 7 },
        },
      });

      // Data de referência: 2026-11-06
      const dataHoje = new Date('2026-11-06T12:00:00Z');

      // 2. Criar conta vencendo em 6 dias (dia 12) -> Dentro dos 7 dias
      const resConta = await app.inject({
        method: 'POST',
        url: '/api/contas-pagar',
        headers: { authorization: `Bearer ${tokenUser1}` },
        payload: {
          descricao: 'Seguro do Carro',
          valor: 350.0,
          diaVencimento: 12,
          dataVencimento: '2026-11-12',
        },
      });
      const conta = JSON.parse(resConta.payload).conta;

      // 3. Executa o worker
      const resWorker = await alertaContasVencerWorkerService.processarAlertasUsuario(
        user1Id,
        dataHoje
      );
      expect(resWorker.totalAlertasCriados).toBeGreaterThanOrEqual(1);

      // 4. Verifica se alerta foi criado com referência à regra
      const alerta = await prisma.alertaSistema.findFirst({
        where: {
          usuarioId: user1Id,
          entidadeId: conta.id,
          tipo: 'CONTA_A_VENCER',
        },
      });
      expect(alerta).toBeDefined();
      expect(alerta?.regraAlertaId).toBe(regraVencer.id);
    });

    it('não deve emitir alerta se a regra estiver desativada pelo usuário', async () => {
      // 1. Desativar a regra CONTA_A_VENCER
      const resList = await app.inject({
        method: 'GET',
        url: '/api/alertas/regras',
        headers: { authorization: `Bearer ${tokenUser1}` },
      });
      const regraVencer = JSON.parse(resList.payload).regras.find(
        (r: any) => r.codigo === 'CONTA_A_VENCER'
      );

      await app.inject({
        method: 'PUT',
        url: `/api/alertas/regras/${regraVencer.id}`,
        headers: { authorization: `Bearer ${tokenUser1}` },
        payload: { ativo: false },
      });

      const dataHoje = new Date('2026-11-06T12:00:00Z');

      // 2. Criar nova conta vencendo amanhã (dia 7)
      const resConta = await app.inject({
        method: 'POST',
        url: '/api/contas-pagar',
        headers: { authorization: `Bearer ${tokenUser1}` },
        payload: {
          descricao: 'Plano de Saúde',
          valor: 800.0,
          diaVencimento: 7,
          dataVencimento: '2026-11-07',
        },
      });
      const conta = JSON.parse(resConta.payload).conta;

      // 3. Executar o worker
      await alertaContasVencerWorkerService.processarAlertasUsuario(user1Id, dataHoje);

      // Alerta NÃO deve ter sido criado porque a regra está desativada
      const alerta = await prisma.alertaSistema.findFirst({
        where: {
          usuarioId: user1Id,
          entidadeId: conta.id,
          tipo: 'CONTA_A_VENCER',
        },
      });
      expect(alerta).toBeNull();
    });
  });
});
