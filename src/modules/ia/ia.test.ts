import { describe, it, expect, beforeAll } from 'vitest';
import { buildApp } from '../../app.js';
import { FastifyInstance } from 'fastify';
import { buildIaSystemPrompt, parseLocalDeterministic, ContextoUsuarioIA } from './ia.service.js';

describe('Módulo de IA para Registro de Lançamentos (TASK-12)', () => {
  let app: FastifyInstance;
  let tokenAuth: string;

  const mockContexto: ContextoUsuarioIA = {
    contas: [
      { id: 'c-nubank', nome: 'Nubank Cartão', tipo: 'CARTAO_CREDITO' },
      { id: 'c-itau', nome: 'Itaú CC', tipo: 'CONTA_CORRENTE' },
    ],
    categorias: [
      { id: 'cat-alim', nome: 'Alimentação' },
      { id: 'cat-hab', nome: 'Habitação' },
      { id: 'cat-transp', nome: 'Transporte' },
    ],
    dataReferencia: '2026-10-11',
  };

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Cadastro e login para obter token de autenticação
    const email = `test-ia-${Date.now()}@exemplo.com`;
    const resCadastro = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario IA Teste',
        email,
        senha: 'SenhaSegura123!',
      },
    });

    const cookies = resCadastro.cookies;
    const tokenCookie = cookies.find((c) => c.name === 'token');
    tokenAuth = tokenCookie?.value || '';
  });

  describe('Unidade: Prompt Builder e Parser Determinístico', () => {
    it('deve gerar o system prompt completo com contas e categorias', () => {
      const prompt = buildIaSystemPrompt(mockContexto);
      expect(prompt).toContain('Evolvi');
      expect(prompt).toContain('Nubank Cartão');
      expect(prompt).toContain('Alimentação');
      expect(prompt).toContain('2026-10-11');
      expect(prompt).toContain('isPagamentoFatura');
    });

    it('deve interpretar despesa comum em linguagem natural', () => {
      const resultado = parseLocalDeterministic(
        'Almoço executivo no restaurante X R$ 45,50 no cartão Nubank',
        mockContexto
      );
      expect(resultado.valor).toBe(45.5);
      expect(resultado.natureza).toBe('DESPESA');
      expect(resultado.contaId).toBe('c-nubank');
      expect(resultado.categoriaId).toBe('cat-alim');
      expect(resultado.isPagamentoFatura).toBe(false);
    });

    it('deve identificar pagamento de fatura de cartão com anti-dupla contagem', () => {
      const resultado = parseLocalDeterministic(
        'Paguei a fatura do cartão de crédito Nubank R$ 1250,00',
        mockContexto
      );
      expect(resultado.valor).toBe(1250.0);
      expect(resultado.natureza).toBe('TRANSFERENCIA_PROPRIA');
      expect(resultado.isPagamentoFatura).toBe(true);
    });

    it('deve extrair informações de parcelamento quando mencionadas', () => {
      const resultado = parseLocalDeterministic(
        'Comprei pneu novo em 4x de R$ 150,00 no cartão',
        mockContexto
      );
      expect(resultado.parcelasTotal).toBe(4);
      expect(resultado.parcelaAtual).toBe(1);
    });
  });

  describe('Integração: Endpoints /api/ia', () => {
    it('GET /api/ia/contexto deve retornar contexto e prompt exportável', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/ia/contexto',
        cookies: { token: tokenAuth },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('contexto');
      expect(body).toHaveProperty('promptExportavel');
      expect(typeof body.promptExportavel).toBe('string');
    });

    it('POST /api/ia/parse deve interpretar texto em linguagem natural no modo CREDITOS', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/ia/parse',
        cookies: { token: tokenAuth },
        payload: {
          texto: 'Almoço no restaurante japonês R$ 89,90',
          modo: 'CREDITOS',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.modo).toBe('CREDITOS');
      expect(body.lancamento.valor).toBe(89.9);
      expect(body.lancamento.natureza).toBe('DESPESA');
      expect(body.creditosConsumidos).toBe(1);
    });

    it('POST /api/ia/parse deve aceitar e normalizar JSON colado externamente', async () => {
      const jsonColado = JSON.stringify({
        descricao: 'Compra de Teclado Mecânico',
        valor: 350.0,
        natureza: 'DESPESA',
        isPagamentoFatura: false,
        categoriaNomeSugerida: 'Habitação',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/ia/parse',
        cookies: { token: tokenAuth },
        payload: {
          texto: jsonColado,
          modo: 'EXTERNO',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.lancamento.descricao).toBe('Compra de Teclado Mecânico');
      expect(body.lancamento.valor).toBe(350.0);
    });

    it('POST /api/ia/testar-conexao deve responder erro se chave do Gemini for inválida', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/ia/testar-conexao',
        cookies: { token: tokenAuth },
        payload: {
          provedor: 'GEMINI',
          apiKey: 'AIzaSyChaveInvalidaParaTesteDeErro12345',
        },
      });

      // Como a chave é falsa, o Google Gemini rejeita com 400
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.sucesso).toBe(false);
    }, 15000);
  });
});
