import { describe, it, expect, beforeAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { baselineService } from '../fase1/baseline.service.js';

describe('TASK-46: Módulo de Investimentos e Registro de Aportes (Fase 1 Light)', () => {
  let app: FastifyInstance;
  let usuario1Id: string;
  let usuario1Token: string;
  let conta1Id: string;

  let usuario2Id: string;
  let usuario2Token: string;
  let conta2Id: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Criar Usuário 1
    const resCad1 = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Investidor Alfa',
        email: `investidor-alfa-${Date.now()}@teste.com`,
        senha: 'SenhaForte123!',
      },
    });
    const body1 = JSON.parse(resCad1.body);
    usuario1Id = body1.usuario.id;
    usuario1Token = body1.token;

    const conta1 = await prisma.conta.create({
      data: {
        usuarioId: usuario1Id,
        nome: 'Nubank NuInvest Alfa',
        tipo: 'INVESTIMENTO',
      },
    });
    conta1Id = conta1.id;

    // 2. Criar Usuário 2 para teste de isolamento multi-tenant
    const resCad2 = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Investidor Beta',
        email: `investidor-beta-${Date.now()}@teste.com`,
        senha: 'SenhaForte123!',
      },
    });
    const body2 = JSON.parse(resCad2.body);
    usuario2Id = body2.usuario.id;
    usuario2Token = body2.token;

    const conta2 = await prisma.conta.create({
      data: {
        usuarioId: usuario2Id,
        nome: 'Banco Inter Beta',
        tipo: 'CONTA_CORRENTE',
      },
    });
    conta2Id = conta2.id;
  });

  it('1. POST /api/investimentos/aportes deve registrar aporte manual com natureza APORTE_PATRIMONIAL e categoriaFixadaPeloUsuario', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/investimentos/aportes',
      headers: {
        authorization: `Bearer ${usuario1Token}`,
      },
      payload: {
        dataAporte: '2026-10-15',
        contaId: conta1Id,
        descricao: 'CDB Pós-Fixado 100% CDI Liquidez Diária',
        valor: 1500.0,
        observacao: 'Reserva inicial da Fase 1',
        produtoTipo: 'CDB',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.message).toContain('sucesso');
    expect(body.aporte).toBeDefined();
    expect(body.aporte.valor).toBe(1500.0);
    expect(body.aporte.natureza).toBe('APORTE_PATRIMONIAL');
    expect(body.aporte.status).toBe('CONCILIADO');
    expect(body.aporte.categoriaFixadaPeloUsuario).toBe(true);
    expect(body.aporte.origemDocumento).toBe('CADASTRO_MANUAL_APORTE');

    // Validação no banco de dados com isolamento do usuarioId
    const aporteDb = await prisma.movimento.findUnique({
      where: { id: body.aporte.id },
    });
    expect(aporteDb).not.toBeNull();
    expect(aporteDb?.usuarioId).toBe(usuario1Id);
    expect(aporteDb?.natureza).toBe('APORTE_PATRIMONIAL');
    expect(aporteDb?.categoriaFixadaPeloUsuario).toBe(true);
  });

  it('2. POST /api/investimentos/aportes deve bloquear tentativa de registrar aporte em conta de outro usuário (Multi-Tenant)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/investimentos/aportes',
      headers: {
        authorization: `Bearer ${usuario1Token}`,
      },
      payload: {
        dataAporte: '2026-10-15',
        contaId: conta2Id, // Pertence ao usuário 2!
        descricao: 'Tentativa Invasão de Conta',
        valor: 500.0,
      },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.message).toContain('não encontrada ou não pertence ao usuário');
  });

  it('3. POST /api/investimentos/aportes deve validar duplicata idêntica (409 Conflict)', async () => {
    // Tenta registrar exatamente o mesmo aporte da etapa 1
    const res = await app.inject({
      method: 'POST',
      url: '/api/investimentos/aportes',
      headers: {
        authorization: `Bearer ${usuario1Token}`,
      },
      payload: {
        dataAporte: '2026-10-15',
        contaId: conta1Id,
        descricao: 'CDB Pós-Fixado 100% CDI Liquidez Diária',
        valor: 1500.0,
      },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.message).toContain('Já existe um aporte idêntico');
  });

  it('4. GET /api/investimentos/aportes deve listar os aportes do usuário com totais, KPIs e paginação', async () => {
    // Inserir um segundo aporte em competência diferente
    await app.inject({
      method: 'POST',
      url: '/api/investimentos/aportes',
      headers: {
        authorization: `Bearer ${usuario1Token}`,
      },
      payload: {
        dataAporte: '2026-10-20',
        contaId: conta1Id,
        descricao: 'Tesouro Selic 2029',
        valor: 2500.0,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/investimentos/aportes?competencia=2026-10',
      headers: {
        authorization: `Bearer ${usuario1Token}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.resumo.totalAportado).toBe(4000.0);
    expect(body.resumo.quantidadeAportes).toBe(2);
    expect(body.resumo.ultimaAplicacao).toBe('2026-10-20');
    expect(body.aportes.length).toBe(2);

    // Conferir inferência inteligente de tipo de produto
    const descricoes = body.aportes.map((a: any) => a.produtoTipo);
    expect(descricoes).toContain('CDB');
    expect(descricoes).toContain('Tesouro Direto');

    // Usuário 2 não deve ver os aportes do Usuário 1
    const resUser2 = await app.inject({
      method: 'GET',
      url: '/api/investimentos/aportes?competencia=2026-10',
      headers: {
        authorization: `Bearer ${usuario2Token}`,
      },
    });
    const bodyUser2 = JSON.parse(resUser2.body);
    expect(bodyUser2.resumo.totalAportado).toBe(0);
    expect(bodyUser2.aportes.length).toBe(0);
  });

  it('5. Aportes patrimoniais manuais NÃO devem impactar despesas ordinárias nem o Baseline da Fase 1', async () => {
    // Atualizar renda base do Usuário 1 para R$ 5.000
    await app.inject({
      method: 'PUT',
      url: '/api/usuario/renda-base',
      headers: {
        authorization: `Bearer ${usuario1Token}`,
      },
      payload: {
        rendaBaseMensal: 5000.0,
      },
    });

    // Inserir uma despesa de consumo regular de R$ 300,00
    await app.inject({
      method: 'POST',
      url: '/api/movimentos',
      headers: {
        authorization: `Bearer ${usuario1Token}`,
      },
      payload: {
        contaId: conta1Id,
        dataMovimento: '2026-10-10',
        descricao: 'Supermercado Mensal',
        valor: 300.0,
        natureza: 'DESPESA',
      },
    });

    // Consulta resumo de movimentos do mês 2026-10
    const resMov = await app.inject({
      method: 'GET',
      url: '/api/movimentos?competencia=2026-10',
      headers: {
        authorization: `Bearer ${usuario1Token}`,
      },
    });

    const bodyMov = JSON.parse(resMov.body);
    expect(bodyMov.resumo.totalDespesasConsumo).toBe(300.0);
    expect(bodyMov.resumo.totalAportesPatrimoniais).toBe(4000.0);
    expect(bodyMov.resumo.saldoOperacionalConsumo).toBe(-300.0); // 0 receita - 300 despesa

    // O baseline da Fase 1 deve considerar despesas de consumo, nunca os R$ 4.000 de aportes
    // Se referência for 2026-11, os 6 meses fechados incluem 2026-10
    const baseline = await baselineService.calcularBaseline(usuario1Id, '2026-11', 6);
    // 300 / 6 = 50.00 de média mensal
    expect(baseline.media_mensal).toBe(50.0);
  });
});
