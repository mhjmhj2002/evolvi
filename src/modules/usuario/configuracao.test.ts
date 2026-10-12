import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { configuracaoService } from './configuracao.service.js';
import { baselineService } from '../fase1/baseline.service.js';
import { historicoConsumoService } from '../fase1/historico.service.js';
import { previsaoProjecaoService } from '../fase1/previsao.service.js';
import { BankHubService } from '../conector/bank-hub.service.js';

describe('TASK-27: Janela Temporal Parametrizável (3 a 12 Meses) em Banco e Cadastros', () => {
  let app: FastifyInstance;

  const testUserA = {
    nome: 'Usuario Janela Temporal A',
    email: `janela_a_${Date.now()}@teste.com`,
    senha: 'SenhaForte123!',
    rendaBaseMensal: 10000.0,
  };

  const testUserB = {
    nome: 'Usuario Janela Temporal B',
    email: `janela_b_${Date.now()}@teste.com`,
    senha: 'SenhaForte123!',
    rendaBaseMensal: 8000.0,
  };

  let tokenA: string;
  let usuarioIdA: string;
  let tokenB: string;
  let usuarioIdB: string;

  let contaIdA: string;
  let catMoradiaId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Cadastrar Usuário A
    const resA = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: testUserA,
    });
    const bodyA = JSON.parse(resA.body);
    tokenA = bodyA.token;
    usuarioIdA = bodyA.usuario.id;

    // 2. Cadastrar Usuário B (multi-tenant)
    const resB = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: testUserB,
    });
    const bodyB = JSON.parse(resB.body);
    tokenB = bodyB.token;
    usuarioIdB = bodyB.usuario.id;

    // 3. Criar Conta para Usuário A
    const resConta = await app.inject({
      method: 'POST',
      url: '/api/contas',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        nome: 'Conta Corrente Janela Teste',
        tipo: 'CONTA_CORRENTE',
        saldoInicial: 5000.0,
      },
    });
    contaIdA = JSON.parse(resConta.body).conta.id;

    // 4. Buscar categoria para movimentos de teste
    const moradia = await prisma.categoria.findFirst({
      where: { nome: 'Moradia', categoriaPaiId: null },
    });
    catMoradiaId = moradia!.id;

    // 5. Inserir despesas e receitas para os últimos 12 meses fechados para o Usuário A
    // Competência ref: 2026-10. Meses fechados: 2025-10 a 2026-09
    const movimentosParaInserir = [];
    const competencias12M = [
      '2025-10', '2025-11', '2025-12',
      '2026-01', '2026-02', '2026-03',
      '2026-04', '2026-05', '2026-06',
      '2026-07', '2026-08', '2026-09',
    ];

    for (const comp of competencias12M) {
      movimentosParaInserir.push({
        usuarioId: usuarioIdA,
        contaId: contaIdA,
        categoriaId: catMoradiaId,
        dataMovimento: new Date(`${comp}-10T12:00:00Z`),
        competencia: comp,
        descricao: `Despesa ${comp}`,
        valor: 1000.0,
        natureza: 'DESPESA' as const,
        status: 'CONCILIADO' as const,
      });
      movimentosParaInserir.push({
        usuarioId: usuarioIdA,
        contaId: contaIdA,
        dataMovimento: new Date(`${comp}-05T12:00:00Z`),
        competencia: comp,
        descricao: `Receita ${comp}`,
        valor: 5000.0,
        natureza: 'RECEITA' as const,
        status: 'CONCILIADO' as const,
      });
    }

    await prisma.movimento.createMany({
      data: movimentosParaInserir,
    });
  });

  afterAll(async () => {
    if (usuarioIdA || usuarioIdB) {
      await prisma.movimento.deleteMany({
        where: { usuarioId: { in: [usuarioIdA, usuarioIdB].filter(Boolean) } },
      });
      await prisma.conta.deleteMany({
        where: { usuarioId: { in: [usuarioIdA, usuarioIdB].filter(Boolean) } },
      });
      await prisma.configuracaoUsuario.deleteMany({
        where: { usuarioId: { in: [usuarioIdA, usuarioIdB].filter(Boolean) } },
      });
      await prisma.usuario.deleteMany({
        where: { id: { in: [usuarioIdA, usuarioIdB].filter(Boolean) } },
      });
    }
  });

  describe('1. Persistência e Regras de Validação (Banco e API)', () => {
    it('deve retornar configuração padrão de 6 meses para usuário sem configuração criada', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/usuario/configuracoes',
        headers: { authorization: `Bearer ${tokenA}` },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.mesesJanelaTemporal).toBe(6);
      expect(data.limites).toEqual({ minimo: 3, maximo: 12, padrao: 6 });
    });

    it('deve rejeitar valor menor que 3 meses (400 Bad Request)', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/usuario/configuracoes',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { mesesJanelaTemporal: 2 },
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.body);
      expect(data.error).toBe('Bad Request');
    });

    it('deve rejeitar valor maior que 12 meses (400 Bad Request)', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/usuario/configuracoes',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { mesesJanelaTemporal: 15 },
      });

      expect(res.statusCode).toBe(400);
    });

    it('deve rejeitar valor não inteiro (400 Bad Request)', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/usuario/configuracoes',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { mesesJanelaTemporal: 4.5 },
      });

      expect(res.statusCode).toBe(400);
    });

    it('deve atualizar com sucesso a janela temporal para 3 meses e persistir no banco', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/usuario/configuracoes',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { mesesJanelaTemporal: 3 },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.mesesJanelaTemporal).toBe(3);

      // Verificar persistência direta no PostgreSQL
      const configBanco = await prisma.configuracaoUsuario.findUnique({
        where: { usuarioId: usuarioIdA },
      });
      expect(configBanco).toBeDefined();
      expect(configBanco!.mesesJanelaTemporal).toBe(3);
    });

    it('deve manter isolamento multi-tenant garantindo que Usuário B continua com o padrão 6', async () => {
      const resB = await app.inject({
        method: 'GET',
        url: '/api/usuario/configuracoes',
        headers: { authorization: `Bearer ${tokenB}` },
      });

      expect(resB.statusCode).toBe(200);
      const dataB = JSON.parse(resB.body);
      expect(dataB.mesesJanelaTemporal).toBe(6);
    });
  });

  describe('2. Propagação Transversal nos Motores Analíticos', () => {
    it('BaselineService deve calcular com N=3 meses fechados conforme configuração do usuário', async () => {
      // Usuário A configurado com 3 meses
      const baseline = await baselineService.calcularBaseline(usuarioIdA, '2026-10');
      expect(baseline.meses_analisados.length).toBe(3);
      expect(baseline.meses_analisados).toEqual(['2026-07', '2026-08', '2026-09']);
      expect(baseline.total_periodo).toBe(3000.0); // 3 meses x R$ 1000
      expect(baseline.media_mensal).toBe(1000.0);
    });

    it('GET /api/fase1/baseline deve refletir a janela dinâmica configurada', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/fase1/baseline?competenciaReferencia=2026-10',
        headers: { authorization: `Bearer ${tokenA}` },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.meses_analisados.length).toBe(3);
      expect(data.media_mensal).toBe(1000.0);
    });

    it('GET /api/usuario/renda-media-6m deve computar média com base na janela de 3 meses configurada', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/usuario/renda-media-6m?competencia=2026-10',
        headers: { authorization: `Bearer ${tokenA}` },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.mesesJanela).toBe(3);
      expect(data.mesesFechados.length).toBe(3);
      expect(data.mesesFechados).toEqual(['2026-07', '2026-08', '2026-09']);
      expect(data.totalReceitas).toBe(15000.0); // 3 x R$ 5000
      expect(data.media6m).toBe(5000.0);
    });

    it('HistoricoConsumoService deve respeitar a janela de 3 meses do usuário por padrão', async () => {
      const resumo = await historicoConsumoService.obterResumoHistorico(usuarioIdA, '2026-10');
      expect(resumo.janela.total_meses).toBe(3);
      expect(resumo.janela.meses_fechados).toEqual(['2026-07', '2026-08', '2026-09']);
    });

    it('PrevisaoProjecaoService deve projetar 3 competências futuras quando usuário configurado para 3 meses', async () => {
      const projecao = await previsaoProjecaoService.calcularProjecaoSeisMeses(usuarioIdA, '2026-10');
      expect(projecao.mesesProjetados.length).toBe(3);
      expect(projecao.mesesProjetados).toEqual(['2026-10', '2026-11', '2026-12']);
      expect(projecao.meses.length).toBe(3);
      expect(projecao.meses[0].competencia).toBe('2026-10');
      expect(projecao.meses[2].competencia).toBe('2026-12');
    });

    it('quando usuário altera janela para 12 meses, todos os motores devem expandir para 12 meses', async () => {
      // Atualizar para 12 meses
      await app.inject({
        method: 'PUT',
        url: '/api/usuario/configuracoes',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { mesesJanelaTemporal: 12 },
      });

      // 1. Baseline
      const baseline = await baselineService.calcularBaseline(usuarioIdA, '2026-10');
      expect(baseline.meses_analisados.length).toBe(12);
      expect(baseline.total_periodo).toBe(12000.0);
      expect(baseline.media_mensal).toBe(1000.0);

      // 2. Média de receitas
      const resRenda = await app.inject({
        method: 'GET',
        url: '/api/usuario/renda-media-6m?competencia=2026-10',
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const dataRenda = JSON.parse(resRenda.body);
      expect(dataRenda.mesesJanela).toBe(12);
      expect(dataRenda.totalReceitas).toBe(60000.0);
      expect(dataRenda.media6m).toBe(5000.0);

      // 3. Previsão
      const projecao = await previsaoProjecaoService.calcularProjecaoSeisMeses(usuarioIdA, '2026-10');
      expect(projecao.mesesProjetados.length).toBe(12);
    });
  });
});
