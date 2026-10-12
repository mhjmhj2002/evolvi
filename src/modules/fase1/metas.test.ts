import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';

describe('Módulo de Planejamento e Metas do Zero a Zero (TASK-08)', () => {
  let app: FastifyInstance;

  const userTest = {
    nome: 'Usuario Metas Teste',
    email: `metas_${Date.now()}@teste.com`,
    senha: 'SenhaForte123!',
    rendaBaseMensal: 10000.0,
  };

  const invasorTest = {
    nome: 'Usuario Invasor Metas',
    email: `invasor_metas_${Date.now()}@teste.com`,
    senha: 'SenhaForte456!',
    rendaBaseMensal: 6000.0,
  };

  let tokenUser: string;
  let usuarioId: string;
  let tokenInvasor: string;
  let invasorId: string;

  let contaId: string;
  let catMoradiaId: string;
  let catAlimentacaoId: string;
  let catTransporteId: string;
  let catSaudeId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Cadastrar usuário principal
    const respUser = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: userTest,
    });
    const bodyUser = JSON.parse(respUser.body);
    tokenUser = bodyUser.token;
    usuarioId = bodyUser.usuario.id;

    // 2. Cadastrar usuário invasor (para testes multi-tenant)
    const respInvasor = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: invasorTest,
    });
    const bodyInvasor = JSON.parse(respInvasor.body);
    tokenInvasor = bodyInvasor.token;
    invasorId = bodyInvasor.usuario.id;

    // 3. Criar conta para usuário
    const respConta = await app.inject({
      method: 'POST',
      url: '/api/contas',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload: {
        nome: 'Conta Corrente Metas',
        tipo: 'CONTA_CORRENTE',
        saldoInicial: 15000.0,
      },
    });
    contaId = JSON.parse(respConta.body).conta.id;

    // 4. Buscar categorias raízes do seed
    const moradia = await prisma.categoria.findFirst({
      where: { nome: 'Moradia', categoriaPaiId: null },
    });
    const alimentacao = await prisma.categoria.findFirst({
      where: { nome: 'Alimentacao', categoriaPaiId: null },
    });
    const transporte = await prisma.categoria.findFirst({
      where: { nome: 'Transporte', categoriaPaiId: null },
    });
    const saude = await prisma.categoria.findFirst({
      where: { nome: 'Saude', categoriaPaiId: null },
    });

    if (!moradia || !alimentacao || !transporte || !saude) {
      throw new Error('Categorias POF necessárias não encontradas');
    }

    catMoradiaId = moradia.id;
    catAlimentacaoId = alimentacao.id;
    catTransporteId = transporte.id;
    catSaudeId = saude.id;
  });

  afterAll(async () => {
    if (usuarioId || invasorId) {
      await prisma.metaZeroAZero.deleteMany({
        where: { usuarioId: { in: [usuarioId, invasorId].filter(Boolean) } },
      });
      await prisma.movimento.deleteMany({
        where: { usuarioId: { in: [usuarioId, invasorId].filter(Boolean) } },
      });
      await prisma.conta.deleteMany({
        where: { usuarioId: { in: [usuarioId, invasorId].filter(Boolean) } },
      });
      await prisma.usuario.deleteMany({
        where: { id: { in: [usuarioId, invasorId].filter(Boolean) } },
      });
    }
  });

  it('GET /api/fase1/metas - deve retornar sugestão inicial quando não há metas cadastradas', async () => {
    const resp = await app.inject({
      method: 'GET',
      url: '/api/fase1/metas?competencia=2026-10',
      headers: { authorization: `Bearer ${tokenUser}` },
    });

    expect(resp.statusCode).toBe(200);
    const data = JSON.parse(resp.body);

    expect(data.competencia).toBe('2026-10');
    expect(data.renda_base).toBe(10000.0);
    expect(Array.isArray(data.metas)).toBe(true);
    expect(data.metas.length).toBeGreaterThan(0);

    const metaMoradia = data.metas.find((m: any) => m.categoria_id === catMoradiaId);
    expect(metaMoradia).toBeDefined();
    expect(metaMoradia.nome_categoria).toBe('Moradia');
    expect(metaMoradia.status_semaforo).toBeDefined();
  });

  it('POST /api/fase1/metas - deve REJEITAR plano cuja soma das metas ultrapasse a renda base líquida', async () => {
    // Renda base do usuário é 10.000,00
    // Enviar metas cuja soma seja 11.500,00 (estouro de 1.500,00)
    const payloadInvalido = {
      competencia: '2026-10',
      metas: [
        {
          categoriaId: catMoradiaId,
          metaProposta: 6000.0,
          condicaoAcao: 'Aluguel e taxas',
        },
        {
          categoriaId: catAlimentacaoId,
          metaProposta: 4000.0,
          condicaoAcao: 'Supermercado e feira',
        },
        {
          categoriaId: catTransporteId,
          metaProposta: 1500.0,
          condicaoAcao: 'Combustível',
        },
      ],
    };

    const resp = await app.inject({
      method: 'POST',
      url: '/api/fase1/metas',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload: payloadInvalido,
    });

    expect(resp.statusCode).toBe(422);
    const body = JSON.parse(resp.body);
    expect(body.error).toBe('Unprocessable Entity');
    expect(body.message).toContain('Plano rejeitado: A soma das metas propostas');
    expect(body.message).toContain('ultrapassa a Renda Base mensal (R$ 10000.00)');
  });

  it('POST /api/fase1/metas - deve ACEITAR plano onde a soma das metas é <= Renda Base (Gap pós-meta = 0.00)', async () => {
    // Renda: 10.000,00. Soma das metas: 4.000 + 3.000 + 1.500 + 1.000 = 9.500,00 (<= 10.000,00)
    const payloadValido = {
      competencia: '2026-10',
      metas: [
        {
          categoriaId: catMoradiaId,
          metaProposta: 4000.0,
          condicaoAcao: 'Preservar aluguel e despesas do lar',
        },
        {
          categoriaId: catAlimentacaoId,
          metaProposta: 3000.0,
          condicaoAcao: 'Teto para alimentação e delivery',
        },
        {
          categoriaId: catTransporteId,
          metaProposta: 1500.0,
          condicaoAcao: 'Uso consciente de aplicativos',
        },
        {
          categoriaId: catSaudeId,
          metaProposta: 1000.0,
          condicaoAcao: 'Plano e remédios contínuos',
        },
      ],
    };

    const resp = await app.inject({
      method: 'POST',
      url: '/api/fase1/metas',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload: payloadValido,
    });

    expect(resp.statusCode).toBe(200);
    const data = JSON.parse(resp.body);

    expect(data.competencia).toBe('2026-10');
    expect(data.renda_base).toBe(10000.0);
    expect(data.total_meta_proposta).toBe(9500.0);
    expect(data.gap_pos_meta).toBe(0.0);
    expect(data.equacionado).toBe(true);

    const mMoradia = data.metas.find((m: any) => m.categoria_id === catMoradiaId);
    expect(mMoradia.meta_proposta).toBe(4000.0);
    expect(mMoradia.condicao_acao).toBe('Preservar aluguel e despesas do lar');

    const mAlimentacao = data.metas.find((m: any) => m.categoria_id === catAlimentacaoId);
    expect(mAlimentacao.meta_proposta).toBe(3000.0);
    expect(mAlimentacao.condicao_acao).toBe('Teto para alimentação e delivery');
  });

  it('GET /api/fase1/metas - deve retornar as metas persistidas da competência', async () => {
    const resp = await app.inject({
      method: 'GET',
      url: '/api/fase1/metas?competencia=2026-10',
      headers: { authorization: `Bearer ${tokenUser}` },
    });

    expect(resp.statusCode).toBe(200);
    const data = JSON.parse(resp.body);

    expect(data.competencia).toBe('2026-10');
    expect(data.total_meta_proposta).toBe(9500.0);
    expect(data.gap_pos_meta).toBe(0.0);
    expect(data.equacionado).toBe(true);
    expect(data.metas.length).toBe(4);
  });

  it('GET /api/fase1/metas/execucao - deve calcular desvios em tempo real (dentro da meta vs estouro)', async () => {
    // Inserir movimentos na competência 2026-10:
    // Moradia: gasto 3.800 (meta: 4.000) -> sobra/economia de +200,00 (DENTRO_DA_META)
    // Alimentacao: gasto 3.400 (meta: 3.000) -> estouro de -400,00 (ESTOURO_DE_META)
    // Transporte: gasto 1.500 (meta: 1.500) -> desvio 0,00 (DENTRO_DA_META)
    // Saude: gasto 0 (meta: 1.000) -> economia de +1.000,00 (DENTRO_DA_META)

    await prisma.movimento.createMany({
      data: [
        {
          usuarioId,
          contaId,
          categoriaId: catMoradiaId,
          dataMovimento: new Date('2026-10-05T00:00:00.000Z'),
          competencia: '2026-10',
          descricao: 'Aluguel do mês',
          valor: 3800.0,
          natureza: 'DESPESA',
          status: 'CONCILIADO',
        },
        {
          usuarioId,
          contaId,
          categoriaId: catAlimentacaoId,
          dataMovimento: new Date('2026-10-10T00:00:00.000Z'),
          competencia: '2026-10',
          descricao: 'Supermercado e Restaurantes',
          valor: 3400.0,
          natureza: 'DESPESA',
          status: 'CONCILIADO',
        },
        {
          usuarioId,
          contaId,
          categoriaId: catTransporteId,
          dataMovimento: new Date('2026-10-12T00:00:00.000Z'),
          competencia: '2026-10',
          descricao: 'Combustível e Uber',
          valor: 1500.0,
          natureza: 'DESPESA',
          status: 'CONCILIADO',
        },
      ],
    });

    const resp = await app.inject({
      method: 'GET',
      url: '/api/fase1/metas/execucao?competencia=2026-10',
      headers: { authorization: `Bearer ${tokenUser}` },
    });

    expect(resp.statusCode).toBe(200);
    const data = JSON.parse(resp.body);

    expect(data.competencia).toBe('2026-10');
    expect(data.renda_base).toBe(10000.0);
    expect(data.total_meta).toBe(9500.0);
    // Total realizado = 3.800 + 3.400 + 1.500 = 8.700,00
    expect(data.total_realizado).toBe(8700.0);
    // Desvio total = 9.500 - 8.700 = +800,00
    expect(data.desvio_total).toBe(800.0);
    // Saldo disponível = 10.000 - 8.700 = +1.300,00
    expect(data.saldo_disponivel_mes).toBe(1300.0);

    // Avaliar Moradia
    const exMoradia = data.categorias.find((c: any) => c.categoria_id === catMoradiaId);
    expect(exMoradia.meta_proposta).toBe(4000.0);
    expect(exMoradia.gasto_realizado).toBe(3800.0);
    expect(exMoradia.desvio).toBe(200.0); // Economia positiva
    expect(exMoradia.pct_atingimento).toBe(95.0);
    expect(exMoradia.situacao).toBe('DENTRO_DA_META');

    // Avaliar Alimentacao (Estouro)
    const exAlimentacao = data.categorias.find((c: any) => c.categoria_id === catAlimentacaoId);
    expect(exAlimentacao.meta_proposta).toBe(3000.0);
    expect(exAlimentacao.gasto_realizado).toBe(3400.0);
    expect(exAlimentacao.desvio).toBe(-400.0); // Estouro negativo
    expect(exAlimentacao.pct_atingimento).toBe(113.33);
    expect(exAlimentacao.situacao).toBe('ESTOURO_DE_META');

    // Avaliar Transporte
    const exTransporte = data.categorias.find((c: any) => c.categoria_id === catTransporteId);
    expect(exTransporte.meta_proposta).toBe(1500.0);
    expect(exTransporte.gasto_realizado).toBe(1500.0);
    expect(exTransporte.desvio).toBe(0.0);
    expect(exTransporte.pct_atingimento).toBe(100.0);
    expect(exTransporte.situacao).toBe('DENTRO_DA_META');

    // Avaliar Saude
    const exSaude = data.categorias.find((c: any) => c.categoria_id === catSaudeId);
    expect(exSaude.meta_proposta).toBe(1000.0);
    expect(exSaude.gasto_realizado).toBe(0.0);
    expect(exSaude.desvio).toBe(1000.0);
    expect(exSaude.pct_atingimento).toBe(0.0);
    expect(exSaude.situacao).toBe('DENTRO_DA_META');
  });

  it('deve garantir isolamento multi-tenant (invasor não enxerga nem altera metas do outro)', async () => {
    // Invasor consulta metas para 2026-10
    const respInvasor = await app.inject({
      method: 'GET',
      url: '/api/fase1/metas?competencia=2026-10',
      headers: { authorization: `Bearer ${tokenInvasor}` },
    });

    expect(respInvasor.statusCode).toBe(200);
    const dataInvasor = JSON.parse(respInvasor.body);

    // O invasor tem renda de 6.000 e não tem metas salvas ainda (cai na sugestão)
    expect(dataInvasor.renda_base).toBe(6000.0);
    // Não deve conter os valores do usuário principal (9.500 de meta)
    expect(dataInvasor.total_meta_proposta).not.toBe(9500.0);

    // Execução do invasor
    const respExecInvasor = await app.inject({
      method: 'GET',
      url: '/api/fase1/metas/execucao?competencia=2026-10',
      headers: { authorization: `Bearer ${tokenInvasor}` },
    });

    expect(respExecInvasor.statusCode).toBe(200);
    const dataExecInvasor = JSON.parse(respExecInvasor.body);
    expect(dataExecInvasor.renda_base).toBe(6000.0);
    expect(dataExecInvasor.total_realizado).toBe(0.0);
  });

  it('deve rejeitar categoria inexistente ou inválida no cadastro de metas', async () => {
    const payloadInvalido = {
      competencia: '2026-10',
      metas: [
        {
          categoriaId: '00000000-0000-0000-0000-000000000000',
          metaProposta: 100.0,
        },
      ],
    };

    const resp = await app.inject({
      method: 'POST',
      url: '/api/fase1/metas',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload: payloadInvalido,
    });

    expect(resp.statusCode).toBe(422);
    const body = JSON.parse(resp.body);
    expect(body.message).toContain('não encontrada ou não é uma categoria raiz válida');
  });

  it('deve exigir competência válida em formato YYYY-MM no endpoint de execução', async () => {
    const resp = await app.inject({
      method: 'GET',
      url: '/api/fase1/metas/execucao?competencia=invalida',
      headers: { authorization: `Bearer ${tokenUser}` },
    });

    expect(resp.statusCode).toBe(400);
    const body = JSON.parse(resp.body);
    expect(body.error).toBe('Bad Request');
  });
});
