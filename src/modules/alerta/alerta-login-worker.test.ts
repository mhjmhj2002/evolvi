import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { alertaContasVencerWorkerService } from './worker/alerta-contas-vencer-worker.service.js';
import { authEventBus } from '../../infrastructure/events/auth-event-bus.js';

describe('Disparo do Worker de Alertas de Contas a Vencer no Login', () => {
  let app: FastifyInstance;
  let usuarioId: string;
  let tokenUser: string;
  const email = `login_worker_${Date.now()}@teste.com`;
  const senha = 'SenhaSegura123!';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    alertaContasVencerWorkerService.setupEventListener();

    // 1. Cadastrar usuário
    const resCad = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario Login Worker',
        email,
        senha,
      },
    });
    const cadData = JSON.parse(resCad.payload);
    usuarioId = cadData.usuario.id;
    tokenUser = cadData.token;
  });

  afterAll(async () => {
    alertaContasVencerWorkerService.removeEventListener();
    await prisma.alertaSistema.deleteMany({ where: { usuarioId } });
    await prisma.regraAlerta.deleteMany({ where: { usuarioId } });
    await prisma.contaPagar.deleteMany({ where: { usuarioId } });
    await prisma.usuario.deleteMany({ where: { id: usuarioId } });
    await app.close();
  });

  it('deve disparar automaticamente o worker de contas a vencer após o login', async () => {
    // 1. Cadastrar uma conta a pagar vencendo em 2 dias
    const resConta = await app.inject({
      method: 'POST',
      url: '/api/contas-pagar',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload: {
        descricao: 'Boleto Faculdade',
        valor: 1200.0,
        diaVencimento: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).getUTCDate(),
        dataVencimento: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      },
    });
    expect(resConta.statusCode).toBe(201);
    const contaId = JSON.parse(resConta.payload).conta.id;

    // Garantir que nenhum alerta foi gerado ainda
    let alerta = await prisma.alertaSistema.findFirst({
      where: { usuarioId, entidadeId: contaId },
    });
    expect(alerta).toBeNull();

    // 2. Executar o login do usuário
    const resLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, senha },
    });
    expect(resLogin.statusCode).toBe(200);

    // 3. Aguardar execução assíncrona do worker disparado via authEventBus
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 4. Verificar que o alerta foi gerado em background após o login
    alerta = await prisma.alertaSistema.findFirst({
      where: { usuarioId, entidadeId: contaId },
    });
    expect(alerta).toBeDefined();
    expect(alerta?.titulo).toContain('Boleto Faculdade');
    expect(alerta?.status).toBe('PENDENTE');
  });
});

