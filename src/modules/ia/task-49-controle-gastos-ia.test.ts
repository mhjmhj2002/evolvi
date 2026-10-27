import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { CryptoService } from '../../infrastructure/security/crypto.service.js';
import {
  calcularCustoIa,
  normalizarTokensIa,
  tokensDeUsageGemini,
  tokensDeUsageOpenAi,
  UsoIaService,
} from './uso-ia.service.js';
import { GeminiIaExtratorClient } from '../importacao/worker/ia-extrator.client.js';
import { COTACAO_USD_BRL_PADRAO } from '../../config/tabela-precos-ia.js';

const COTACAO = COTACAO_USD_BRL_PADRAO;

describe('TASK-49: Controle e Auditoria de Gastos de IA', () => {
  let app: FastifyInstance;
  let usuarioAId: string;
  let tokenA: string;
  let usuarioBId: string;
  let tokenB: string;

  const emailA = `gastos-ia-alfa-${Date.now()}@teste.com`;
  const emailB = `gastos-ia-beta-${Date.now()}@teste.com`;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const resA = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: { nome: 'Usuário Gasto IA Alfa', email: emailA, senha: 'SenhaForte123!' },
    });
    const bodyA = JSON.parse(resA.body);
    usuarioAId = bodyA.usuario.id;
    tokenA = bodyA.token;

    const resB = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: { nome: 'Usuário Gasto IA Beta', email: emailB, senha: 'SenhaForte123!' },
    });
    const bodyB = JSON.parse(resB.body);
    usuarioBId = bodyB.usuario.id;
    tokenB = bodyB.token;
  });

  afterAll(async () => {
    await prisma.usoIaLog.deleteMany({ where: { usuarioId: { in: [usuarioAId, usuarioBId] } } });
    await prisma.configuracaoIaUsuario.deleteMany({
      where: { usuarioId: { in: [usuarioAId, usuarioBId] } },
    });
  });

  // ---------------------------------------------------------------------------
  // 1. Cálculo puro de custo por modelo
  // ---------------------------------------------------------------------------
  describe('Cálculo de custo (função pura, sem banco)', () => {
    it('deve calcular custo USD/BRL corretamente para gemini-3.8-flash', () => {
      const custo = calcularCustoIa({
        provedor: 'GEMINI',
        modelo: 'gemini-3.8-flash',
        tokensPrompt: 1_000_000,
        tokensResposta: 1_000_000,
        cotacaoUsdBrl: COTACAO,
      });

      expect(custo.precoConhecido).toBe(true);
      // 1M prompt = $0.30 + 1M resposta = $2.50 => $2.80
      expect(custo.custoUsd).toBeCloseTo(2.8, 6);
      expect(custo.custoBrl).toBeCloseTo(2.8 * COTACAO, 6);
      expect(custo.cotacaoUsdBrl).toBeCloseTo(COTACAO, 4);
    });

    it('deve calcular custo corretamente para gpt-4o-mini e deepseek-chat', () => {
      const openai = calcularCustoIa({
        provedor: 'OPENAI',
        modelo: 'gpt-4o-mini',
        tokensPrompt: 200_000,
        tokensResposta: 100_000,
        cotacaoUsdBrl: 5,
      });
      // 0.2M * 0.15 + 0.1M * 0.60 = 0.03 + 0.06 = 0.09
      expect(openai.custoUsd).toBeCloseTo(0.09, 6);
      expect(openai.custoBrl).toBeCloseTo(0.45, 6);

      const deepseek = calcularCustoIa({
        provedor: 'DEEPSEEK',
        modelo: 'deepseek-chat',
        tokensPrompt: 1_000,
        tokensResposta: 1_000,
        cotacaoUsdBrl: 5,
      });
      // 0.001M * 0.27 + 0.001M * 1.10 = 0.00027 + 0.0011 = 0.00137
      expect(deepseek.custoUsd).toBeCloseTo(0.00137, 6);
    });

    it('deve calcular custo para modelos OpenRouter (provedor/modelo com barra)', () => {
      const custo = calcularCustoIa({
        provedor: 'openrouter',
        modelo: 'deepseek/deepseek-chat',
        tokensPrompt: 1_000_000,
        tokensResposta: 0,
        cotacaoUsdBrl: 5,
      });
      expect(custo.precoConhecido).toBe(true);
      expect(custo.custoUsd).toBeCloseTo(0.27, 6);
    });

    it('modelo desconhecido deve gravar custo nulo e emitir aviso', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const custo = calcularCustoIa({
        provedor: 'GEMINI',
        modelo: 'modelo-futurista-desconhecido',
        tokensPrompt: 5000,
        tokensResposta: 5000,
      });

      expect(custo.precoConhecido).toBe(false);
      expect(custo.custoUsd).toBeNull();
      expect(custo.custoBrl).toBeNull();
      // A cotação é registrada mesmo com custo nulo (auditoria)
      expect(custo.cotacaoUsdBrl).toBeCloseTo(COTACAO, 4);
      expect(custo.aviso).toContain('Modelo desconhecido');

      warnSpy.mockRestore();
    });

    it('normalizarTokensIa deve aceitar ambos os formatos de contagem de tokens', () => {
      expect(
        tokensDeUsageGemini({
          promptTokenCount: 120,
          candidatesTokenCount: 80,
          totalTokenCount: 200,
        })
      ).toEqual({ tokensPrompt: 120, tokensResposta: 80, tokensTotal: 200 });

      expect(
        tokensDeUsageOpenAi({ prompt_tokens: 300, completion_tokens: 150, total_tokens: 450 })
      ).toEqual({ tokensPrompt: 300, tokensResposta: 150, tokensTotal: 450 });

      // Sem usage disponível => zeros (nunca NaN)
      expect(normalizarTokensIa({})).toEqual({
        tokensPrompt: 0,
        tokensResposta: 0,
        tokensTotal: 0,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Registro em falha: status FALHA com tokens 0
  // ---------------------------------------------------------------------------
  describe('UsoIaService.registrar', () => {
    it('falha grava status FALHA com tokens 0 e mensagemErro', async () => {
      const antes = await prisma.usoIaLog.count({ where: { usuarioId: usuarioAId } });

      const criado = await UsoIaService.registrar({
        usuarioId: usuarioAId,
        funcionalidade: 'EXTRACAO_EXTRATO',
        provedor: 'GEMINI',
        modelo: 'gemini-3.8-flash',
        tokensPrompt: 999,
        tokensResposta: 999,
        duracaoMs: 1234,
        status: 'FALHA',
        mensagemErro: 'Quota excedida (HTTP 429)',
      });

      expect(criado?.id).toBeDefined();

      const registro = await prisma.usoIaLog.findUnique({ where: { id: criado!.id } });
      expect(registro).not.toBeNull();
      expect(registro!.status).toBe('FALHA');
      expect(registro!.tokensPrompt).toBe(0);
      expect(registro!.tokensResposta).toBe(0);
      expect(registro!.tokensTotal).toBe(0);
      expect(registro!.mensagemErro).toBe('Quota excedida (HTTP 429)');
      expect(registro!.duracaoMs).toBe(1234);

      const depois = await prisma.usoIaLog.count({ where: { usuarioId: usuarioAId } });
      expect(depois - antes).toBe(1);
    });

    it('sucesso grava exatamente 1 linha com tokens e custo', async () => {
      const antes = await prisma.usoIaLog.count({ where: { usuarioId: usuarioAId } });

      const criado = await UsoIaService.registrar({
        usuarioId: usuarioAId,
        funcionalidade: 'CATEGORIZACAO',
        provedor: 'GEMINI',
        modelo: 'gemini-3.8-flash',
        tokensPrompt: 1000,
        tokensResposta: 500,
        duracaoMs: 800,
        status: 'SUCESSO',
      });

      const registro = await prisma.usoIaLog.findUnique({ where: { id: criado!.id } });
      expect(registro!.tokensTotal).toBe(1500);
      expect(Number(registro!.custoUsd)).toBeCloseTo(0.00155, 6);
      expect(Number(registro!.custoBrl)).toBeCloseTo(0.00155 * COTACAO, 6);
      expect(registro!.mensagemErro).toBeNull();

      const depois = await prisma.usoIaLog.count({ where: { usuarioId: usuarioAId } });
      expect(depois - antes).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Instrumentação do cliente extrator (1 linha por chamada de IA)
  // ---------------------------------------------------------------------------
  describe('Instrumentação do ia-extrator.client.ts', () => {
    const criarConfigDeepSeek = async (usuarioId: string) => {
      const enc = CryptoService.encrypt('sk-deepseek-mock-task49-1234567890');
      await prisma.configuracaoIaUsuario.upsert({
        where: { usuarioId_provedor: { usuarioId, provedor: 'DEEPSEEK' } },
        create: {
          usuarioId,
          provedor: 'DEEPSEEK',
          modelo: 'deepseek-chat',
          apiKeyCifrada: enc.ciphertext,
          ivHex: enc.iv,
          tagHex: enc.tag,
        },
        update: {
          modelo: 'deepseek-chat',
          apiKeyCifrada: enc.ciphertext,
          ivHex: enc.iv,
          tagHex: enc.tag,
        },
      });
    };

    const contexto = {
      contas: [{ id: 'c1', nome: 'Nubank Cartão', tipo: 'CARTAO_CREDITO' }],
      categorias: [{ id: 'cat1', nome: 'Alimentação' }],
      dataReferencia: '2026-10-15',
    };

    it('extração bem-sucedida gera EXATAMENTE 1 log com tokens reais do provedor', async () => {
      await criarConfigDeepSeek(usuarioAId);
      const client = new GeminiIaExtratorClient('');
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    transacoes: [
                      {
                        dataMovimento: '2026-10-10',
                        descricao: 'Almoço Restaurante TASK-49',
                        valor: 42.5,
                        natureza: 'DESPESA',
                        categoriaSugerida: 'Alimentação',
                        isPagamentoFatura: false,
                        confianca: 0.99,
                      },
                    ],
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 1500, completion_tokens: 300, total_tokens: 1800 },
          }),
          text: async () => '',
        } as any;
      });

      const antes = await prisma.usoIaLog.count({ where: { usuarioId: usuarioAId } });

      const transacoes = await client.extrairTransacoes({
        nomeArquivo: 'documento_livre_task49.txt',
        mimeType: 'text/plain',
        conteudoBuffer: Buffer.from('Documento financeiro não estruturado sem colunas', 'utf-8'),
        usuarioId: usuarioAId,
        provedorIa: 'DEEPSEEK',
        modeloIa: 'deepseek-chat',
        contexto,
      });

      globalThis.fetch = originalFetch;

      expect(transacoes.length).toBe(1);
      expect(transacoes[0].descricao).toContain('Almoço');

      const depois = await prisma.usoIaLog.count({ where: { usuarioId: usuarioAId } });
      expect(depois - antes).toBe(1);

      const log = await prisma.usoIaLog.findFirst({
        where: { usuarioId: usuarioAId, funcionalidade: 'EXTRACAO_EXTRATO' },
        orderBy: { criadoEm: 'desc' },
      });

      expect(log).not.toBeNull();
      expect(log!.provedor).toBe('DEEPSEEK');
      expect(log!.modelo).toBe('deepseek-chat');
      expect(log!.status).toBe('SUCESSO');
      expect(log!.tokensPrompt).toBe(1500);
      expect(log!.tokensResposta).toBe(300);
      expect(log!.tokensTotal).toBe(1800);
      expect(Number(log!.custoUsd)).toBeCloseTo((1500 / 1e6) * 0.27 + (300 / 1e6) * 1.1, 6);
      expect(log!.duracaoMs).toBeGreaterThanOrEqual(0);
    });

    it('falha na chamada de IA gera 1 log com status FALHA e tokens 0', async () => {
      await criarConfigDeepSeek(usuarioAId);
      const client = new GeminiIaExtratorClient('');
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: false,
          status: 500,
          json: async () => ({}),
          text: async () => 'internal provider error',
        } as any;
      });

      const antes = await prisma.usoIaLog.count({ where: { usuarioId: usuarioAId } });

      await expect(
        client.extrairTransacoes({
          nomeArquivo: 'documento_livre_task49_falha.txt',
          mimeType: 'text/plain',
          conteudoBuffer: Buffer.from('Documento financeiro não estruturado', 'utf-8'),
          usuarioId: usuarioAId,
          provedorIa: 'DEEPSEEK',
          modeloIa: 'deepseek-chat',
          contexto,
        })
      ).rejects.toThrow();

      globalThis.fetch = originalFetch;

      const depois = await prisma.usoIaLog.count({ where: { usuarioId: usuarioAId } });
      expect(depois - antes).toBe(1);

      const log = await prisma.usoIaLog.findFirst({
        where: { usuarioId: usuarioAId },
        orderBy: { criadoEm: 'desc' },
      });
      expect(log!.status).toBe('FALHA');
      expect(log!.tokensTotal).toBe(0);
      expect(log!.mensagemErro).toContain('DeepSeek');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Endpoint GET /api/ia/consumo
  // ---------------------------------------------------------------------------
  describe('GET /api/ia/consumo', () => {
    beforeAll(async () => {
      await prisma.usoIaLog.deleteMany({ where: { usuarioId: { in: [usuarioAId, usuarioBId] } } });

      // Usuário A: 2 extrações (GEMINI) + 1 categorização (DEEPSEEK)
      await UsoIaService.registrar({
        usuarioId: usuarioAId,
        funcionalidade: 'EXTRACAO_EXTRATO',
        provedor: 'GEMINI',
        modelo: 'gemini-3.8-flash',
        tokensPrompt: 1_000_000,
        tokensResposta: 0,
      });
      await UsoIaService.registrar({
        usuarioId: usuarioAId,
        funcionalidade: 'EXTRACAO_EXTRATO',
        provedor: 'GEMINI',
        modelo: 'gemini-3.8-flash',
        tokensPrompt: 500_000,
        tokensResposta: 500_000,
      });
      await UsoIaService.registrar({
        usuarioId: usuarioAId,
        funcionalidade: 'CATEGORIZACAO',
        provedor: 'DEEPSEEK',
        modelo: 'deepseek-chat',
        tokensPrompt: 1_000_000,
        tokensResposta: 0,
        status: 'FALHA',
        mensagemErro: 'timeout',
      });

      // Usuário B: 1 chamada
      await UsoIaService.registrar({
        usuarioId: usuarioBId,
        funcionalidade: 'CHAT',
        provedor: 'OPENAI',
        modelo: 'gpt-4o-mini',
        tokensPrompt: 1_000_000,
        tokensResposta: 1_000_000,
      });
    });

    it('deve agregar apenas os registros do usuário autenticado (isolamento multi-tenant)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/ia/consumo',
        headers: { authorization: `Bearer ${tokenA}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // 3 chamadas do usuário A (nunca as do usuário B)
      expect(body.totais.chamadas).toBe(3);
      expect(body.totais.chamadasFalha).toBe(1);
      expect(body.totais.chamadasSucesso).toBe(2);

      // Tokens: 1M + 0, 0.5M + 0.5M, 0 (falha zera) => 1M prompt + 0.5M resposta
      expect(body.totais.tokensPrompt).toBe(1_500_000);
      expect(body.totais.tokensResposta).toBe(500_000);

      // Custo: 1M prompt flash ($0.30) + (0.5M*0.3 + 0.5M*2.5 = $1.40) => $1.70
      expect(body.totais.custoUsd).toBeCloseTo(1.7, 6);
      expect(body.totais.custoBrl).toBeCloseTo(1.7 * COTACAO, 6);

      expect(body.porFuncionalidade.length).toBe(2);
      const extracao = body.porFuncionalidade.find(
        (f: any) => f.funcionalidade === 'EXTRACAO_EXTRATO'
      );
      expect(extracao.chamadas).toBe(2);
      expect(extracao.custoUsd).toBeCloseTo(1.7, 6);

      expect(body.porProvedor.length).toBe(2);
      const gemini = body.porProvedor.find((p: any) => p.provedor === 'GEMINI');
      expect(gemini.chamadas).toBe(2);

      expect(body.chamadasRecentes.total).toBe(3);
      expect(body.chamadasRecentes.itens.length).toBe(3);
      expect(body.versaoTabelaPrecos).toBeDefined();

      // Nenhum item do usuário B pode aparecer
      expect(body.porProvedor.some((p: any) => p.provedor === 'OPENAI')).toBe(false);
    });

    it('o usuário B vê apenas seus próprios registros', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/ia/consumo',
        headers: { authorization: `Bearer ${tokenB}` },
      });

      const body = JSON.parse(res.body);
      expect(body.totais.chamadas).toBe(1);
      expect(body.porProvedor.length).toBe(1);
      expect(body.porProvedor[0].provedor).toBe('OPENAI');
      expect(body.porFuncionalidade[0].funcionalidade).toBe('CHAT');
    });

    it('deve aplicar filtros de funcionalidade e provedor', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/ia/consumo?funcionalidade=EXTRACAO_EXTRATO&provedor=GEMINI',
        headers: { authorization: `Bearer ${tokenA}` },
      });

      const body = JSON.parse(res.body);
      expect(body.totais.chamadas).toBe(2);
      expect(body.porFuncionalidade.length).toBe(1);
      expect(body.filtros.funcionalidade).toBe('EXTRACAO_EXTRATO');
      expect(body.filtros.provedor).toBe('GEMINI');
    });

    it('deve aceitar filtro por período (from/to)', async () => {
      const hoje = new Date().toISOString().slice(0, 10);
      const res = await app.inject({
        method: 'GET',
        url: `/api/ia/consumo?dataInicio=${hoje}&dataFim=${hoje}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });

      const body = JSON.parse(res.body);
      expect(res.statusCode).toBe(200);
      expect(body.totais.chamadas).toBe(3);

      const futuro = await app.inject({
        method: 'GET',
        url: '/api/ia/consumo?dataInicio=2030-01-01&dataFim=2030-01-02',
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(JSON.parse(futuro.body).totais.chamadas).toBe(0);
    });

    it('deve validar filtros inválidos com zod (400)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/ia/consumo?dataInicio=15/10/2026&funcionalidade=INVALIDA',
        headers: { authorization: `Bearer ${tokenA}` },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toContain('inválidos');
    });

    it('deve exigir autenticação (401)', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/ia/consumo' });
      expect(res.statusCode).toBe(401);
    });
  });
});
