import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';

describe('BUG-01: Isolamento Rigoroso Multi-Tenant de Dados Cadastrais e Renda Base', () => {
  let app: FastifyInstance;

  const userAlpha = {
    nome: 'Usuario Alpha Isolamento',
    email: `alpha_tenant_${Date.now()}@teste.com`,
    senha: 'SenhaForte123!',
    rendaBaseMensal: 12500.0,
  };

  const userBeta = {
    nome: 'Usuario Beta Isolamento',
    email: `beta_tenant_${Date.now()}@teste.com`,
    senha: 'SenhaForte123!',
    rendaBaseMensal: 4200.0,
  };

  let tokenAlpha: string;
  let usuarioIdAlpha: string;
  let tokenBeta: string;
  let usuarioIdBeta: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Cadastrar Usuário Alpha
    const resA = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: userAlpha,
    });
    const bodyA = JSON.parse(resA.body);
    tokenAlpha = bodyA.token;
    usuarioIdAlpha = bodyA.usuario.id;

    // 2. Cadastrar Usuário Beta
    const resB = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: userBeta,
    });
    const bodyB = JSON.parse(resB.body);
    tokenBeta = bodyB.token;
    usuarioIdBeta = bodyB.usuario.id;
  });

  afterAll(async () => {
    if (usuarioIdAlpha) {
      await prisma.usuario.deleteMany({ where: { id: usuarioIdAlpha } });
    }
    if (usuarioIdBeta) {
      await prisma.usuario.deleteMany({ where: { id: usuarioIdBeta } });
    }
    await app.close();
  });

  it('deve retornar perfis com dados e rendas distintas e isoladas para cada usuário autenticado', async () => {
    const resAlpha = await app.inject({
      method: 'GET',
      url: '/api/usuario/perfil',
      headers: { authorization: `Bearer ${tokenAlpha}` },
    });
    expect(resAlpha.statusCode).toBe(200);
    const bodyAlpha = JSON.parse(resAlpha.body);
    expect(bodyAlpha.usuario.id).toBe(usuarioIdAlpha);
    expect(bodyAlpha.usuario.rendaBaseMensal).toBe(12500.0);

    const resBeta = await app.inject({
      method: 'GET',
      url: '/api/usuario/perfil',
      headers: { authorization: `Bearer ${tokenBeta}` },
    });
    expect(resBeta.statusCode).toBe(200);
    const bodyBeta = JSON.parse(resBeta.body);
    expect(bodyBeta.usuario.id).toBe(usuarioIdBeta);
    expect(bodyBeta.usuario.rendaBaseMensal).toBe(4200.0);
  });

  it('quando Usuário Alpha atualiza sua renda base, os dados de Usuário Beta NÃO devem ser alterados nem contaminados', async () => {
    // Alpha altera renda para 25000.00
    const updateAlpha = await app.inject({
      method: 'PUT',
      url: '/api/usuario/renda-base',
      headers: { authorization: `Bearer ${tokenAlpha}` },
      payload: { rendaBaseMensal: 25000.0 },
    });
    expect(updateAlpha.statusCode).toBe(200);
    const bodyUpdateAlpha = JSON.parse(updateAlpha.body);
    expect(bodyUpdateAlpha.usuario.rendaBaseMensal).toBe(25000.0);

    // Conferir perfil de Alpha
    const perfilAlpha = await app.inject({
      method: 'GET',
      url: '/api/usuario/perfil',
      headers: { authorization: `Bearer ${tokenAlpha}` },
    });
    expect(JSON.parse(perfilAlpha.body).usuario.rendaBaseMensal).toBe(25000.0);

    // Conferir perfil de Beta: deve continuar intacto em 4200.0
    const perfilBeta = await app.inject({
      method: 'GET',
      url: '/api/usuario/perfil',
      headers: { authorization: `Bearer ${tokenBeta}` },
    });
    expect(perfilBeta.statusCode).toBe(200);
    const bodyPerfilBeta = JSON.parse(perfilBeta.body);
    expect(bodyPerfilBeta.usuario.id).toBe(usuarioIdBeta);
    expect(bodyPerfilBeta.usuario.rendaBaseMensal).toBe(4200.0);
  });

  it('Previsão Seis Meses e Decomposição devem usar a renda real do usuário autenticado sem fallback global contaminado', async () => {
    const prevAlpha = await app.inject({
      method: 'GET',
      url: '/api/fase1/previsao/seis-meses',
      headers: { authorization: `Bearer ${tokenAlpha}` },
    });
    expect(prevAlpha.statusCode).toBe(200);
    const bodyPrevAlpha = JSON.parse(prevAlpha.body);
    expect(bodyPrevAlpha.rendaBaseMensal).toBe(25000.0);

    const prevBeta = await app.inject({
      method: 'GET',
      url: '/api/fase1/previsao/seis-meses',
      headers: { authorization: `Bearer ${tokenBeta}` },
    });
    expect(prevBeta.statusCode).toBe(200);
    const bodyPrevBeta = JSON.parse(prevBeta.body);
    expect(bodyPrevBeta.rendaBaseMensal).toBe(4200.0);
  });

  it('não deve permitir acesso ao perfil de outro usuário nem mutação sem token válido', async () => {
    const semToken = await app.inject({
      method: 'GET',
      url: '/api/usuario/perfil',
    });
    expect(semToken.statusCode).toBe(401);

    const tokenInvalido = await app.inject({
      method: 'PUT',
      url: '/api/usuario/renda-base',
      headers: { authorization: 'Bearer token-falso-malicioso' },
      payload: { rendaBaseMensal: 99999.0 },
    });
    expect(tokenInvalido.statusCode).toBe(401);
  });

  it('deve garantir isolamento multi-tenant estrito para contas, movimentos (extrato) e compromissos', async () => {
    // 1. Alpha cria uma conta e um movimento (extrato)
    const respContaA = await app.inject({
      method: 'POST',
      url: '/api/contas',
      headers: { authorization: `Bearer ${tokenAlpha}` },
      payload: {
        nome: 'Conta Exclusiva Alpha',
        tipo: 'CONTA_CORRENTE',
        saldoInicial: 1000.0,
      },
    });
    expect(respContaA.statusCode).toBe(201);
    const contaA = JSON.parse(respContaA.body).conta;

    const respMovA = await app.inject({
      method: 'POST',
      url: '/api/movimentos',
      headers: { authorization: `Bearer ${tokenAlpha}` },
      payload: {
        contaId: contaA.id,
        dataMovimento: '2026-10-10',
        descricao: 'Salário Privado do Alpha',
        valor: 15000.0,
        natureza: 'RECEITA',
        status: 'CONCILIADO',
      },
    });
    expect(respMovA.statusCode).toBe(201);

    // 2. Beta consulta /api/movimentos: NÃO deve ver os lançamentos de Alpha
    const resMovBeta = await app.inject({
      method: 'GET',
      url: '/api/movimentos?competencia=2026-10',
      headers: { authorization: `Bearer ${tokenBeta}` },
    });
    expect(resMovBeta.statusCode).toBe(200);
    const bodyMovBeta = JSON.parse(resMovBeta.body);
    expect(bodyMovBeta.movimentos).toHaveLength(0);
    expect(bodyMovBeta.resumo.totalReceitas).toBe(0);

    // 3. Beta consulta /api/contas: NÃO deve ver a conta de Alpha
    const resContasBeta = await app.inject({
      method: 'GET',
      url: '/api/contas',
      headers: { authorization: `Bearer ${tokenBeta}` },
    });
    expect(resContasBeta.statusCode).toBe(200);
    const bodyContasBeta = JSON.parse(resContasBeta.body);
    expect(bodyContasBeta.contas.some((c: any) => c.id === contaA.id)).toBe(false);

    // 4. Alpha consulta /api/movimentos: deve ver exclusivamente seu lançamento
    const resMovAlpha = await app.inject({
      method: 'GET',
      url: '/api/movimentos?competencia=2026-10',
      headers: { authorization: `Bearer ${tokenAlpha}` },
    });
    expect(resMovAlpha.statusCode).toBe(200);
    const bodyMovAlpha = JSON.parse(resMovAlpha.body);
    expect(bodyMovAlpha.movimentos).toHaveLength(1);
    expect(bodyMovAlpha.movimentos[0].descricao).toBe('Salário Privado do Alpha');
    expect(bodyMovAlpha.resumo.totalReceitas).toBe(15000.0);
  });
});
