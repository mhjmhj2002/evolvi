import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { callOpenRouterApi } from './ia.service.js';
import {
  MODELO_OPENROUTER_PADRAO,
  obterConfigOpenRouter,
} from './openrouter.config.js';

/**
 * Integração do provedor OPENROUTER (sem chamadas reais de rede).
 *
 * Cobre: POST /api/ia/testar-conexao (sucesso e chave inválida),
 * `callOpenRouterApi` (URL/headers/body vindos do ambiente) e
 * POST /api/ia/parse com o provedor OPENROUTER.
 */
describe('OPENROUTER: configuração por ambiente, testar-conexao e parse', () => {
  let app: FastifyInstance;
  let tokenAuth: string;
  let usuarioId: string;

  const config = obterConfigOpenRouter();

  const respostaOpenAiCompativel = (conteudo: string) => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: conteudo } }],
      usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
    }),
    text: async () => '',
  });

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const email = `openrouter-integracao-${Date.now()}@evolvi.app`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: { nome: 'Usuário OpenRouter', email, senha: 'SenhaForte123!' },
    });
    const body = JSON.parse(res.body);
    usuarioId = body.usuario.id;
    tokenAuth = body.token;
  });

  afterAll(async () => {
    if (usuarioId) {
      await prisma.usoIaLog.deleteMany({ where: { usuarioId } });
      await prisma.configuracaoIaUsuario.deleteMany({ where: { usuarioId } });
      await prisma.usuario.deleteMany({ where: { id: usuarioId } });
    }
  });

  describe('GET /api/ia/status e PUT /api/ia/configuracao (contrato do frontend)', () => {
    it('deve expor OPENROUTER sempre, com modeloPadrao e capacidades de mídia honestas', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/ia/status',
        cookies: { token: tokenAuth },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      const suportados: any[] = body.provedoresSuportados;
      const openrouter = suportados.find((p) => p.id === 'OPENROUTER');
      expect(openrouter).toBeDefined();
      expect(openrouter.modeloPadrao).toBe(MODELO_OPENROUTER_PADRAO);
      expect(openrouter.ajudaUrl).toBe('https://openrouter.ai/keys');
      expect(openrouter.modelos).toContain(MODELO_OPENROUTER_PADRAO);
      expect(typeof openrouter.suportaImagens).toBe('boolean');
      expect(typeof openrouter.suportaPdfsNaoEstruturados).toBe('boolean');

      // Cada provedor suportado informa modeloPadrao + capacidades de mídia.
      // O padrão precisa pertencer ao catálogo do provedor (não necessariamente ser o 1º,
      // ex.: OPENAI usa gpt-4o-mini como padrão e gpt-4o como opção mais forte).
      for (const provedor of suportados) {
        expect(provedor.modeloPadrao).toBeTruthy();
        expect(provedor.modelos).toContain(provedor.modeloPadrao);
        expect(typeof provedor.suportaImagens).toBe('boolean');
        expect(typeof provedor.suportaPdfsNaoEstruturados).toBe('boolean');
      }

      // Gemini usa o modelo padrão atual do projeto
      const gemini = suportados.find((p) => p.id === 'GEMINI');
      expect(gemini.modeloPadrao).toBe('gemini-3.8-flash');
      // DeepSeek continua puramente textual
      const deepseek = suportados.find((p) => p.id === 'DEEPSEEK');
      expect(deepseek.suportaImagens).toBe(false);
      // OpenAI/Anthropic existem no catálogo mas não no fluxo de extração
      expect(suportados.find((p) => p.id === 'OPENAI').suportadoNoFluxo).toBe(false);
      expect(suportados.find((p) => p.id === 'ANTHROPIC').suportadoNoFluxo).toBe(false);
    });

    it('PUT /api/ia/configuracao deve devolver e persistir o modelo efetivo (nunca gemini-3.8-flash)', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/ia/configuracao',
        cookies: { token: tokenAuth },
        payload: {
          provedor: 'OPENROUTER',
          apiKey: 'sk-or-v1-chave-integracao-1234567890',
          modelo: 'anthropic/claude-3.5-sonnet',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.provedor).toBe('OPENROUTER');
      expect(body.modelo).toBe('anthropic/claude-3.5-sonnet');

      const persistido = await prisma.configuracaoIaUsuario.findUnique({
        where: { usuarioId_provedor: { usuarioId, provedor: 'OPENROUTER' } },
      });
      expect(persistido?.modelo).toBe('anthropic/claude-3.5-sonnet');

      // Modelo sem prefixo `vendor/` é normalizado para o padrão do projeto
      const resSemVendor = await app.inject({
        method: 'PUT',
        url: '/api/ia/configuracao',
        cookies: { token: tokenAuth },
        payload: {
          provedor: 'OPENROUTER',
          apiKey: 'sk-or-v1-chave-integracao-1234567890',
          modelo: 'deepseek-chat',
        },
      });
      expect(resSemVendor.statusCode).toBe(200);
      expect(JSON.parse(resSemVendor.body).modelo).toBe(MODELO_OPENROUTER_PADRAO);

      // Modelo acima de 60 caracteres gera 400 claro (sem truncamento silencioso)
      const resModeloLongo = await app.inject({
        method: 'PUT',
        url: '/api/ia/configuracao',
        cookies: { token: tokenAuth },
        payload: {
          provedor: 'OPENROUTER',
          apiKey: 'sk-or-v1-chave-integracao-1234567890',
          modelo: `vendor/${'x'.repeat(70)}`,
        },
      });
      expect(resModeloLongo.statusCode).toBe(400);
      expect(JSON.parse(resModeloLongo.body).message).toContain('60 caracteres');

      await prisma.configuracaoIaUsuario.deleteMany({ where: { usuarioId } });
    });
  });

  describe('POST /api/ia/testar-conexao (provedor OPENROUTER)', () => {
    it('deve validar a chave via GET {OPENROUTER_BASE_URL}/auth/key com headers do ambiente', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: { label: 'evolvi' } }),
        text: async () => '',
      } as any);
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as any;

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/ia/testar-conexao',
          cookies: { token: tokenAuth },
          payload: {
            provedor: 'OPENROUTER',
            apiKey: 'sk-or-v1-chave-valida-1234567890',
            modelo: 'deepseek/deepseek-chat',
          },
        });

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.sucesso).toBe(true);
        expect(body.provedor).toBe('OPENROUTER');
        expect(body.message).toContain('OpenRouter');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe(`${config.baseUrl}/auth/key`);
        expect(opts.method).toBe('GET');
        expect(opts.headers.Authorization).toBe('Bearer sk-or-v1-chave-valida-1234567890');
        expect(opts.headers['HTTP-Referer']).toBe(config.httpReferer);
        expect(opts.headers['X-Title']).toBe(config.xTitle);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('deve retornar 401 com mensagem clara quando o OpenRouter rejeita a chave', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'No auth credentials found' } }),
        text: async () => '{"error":{"message":"No auth credentials found"}}',
      } as any);
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as any;

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/ia/testar-conexao',
          cookies: { token: tokenAuth },
          payload: {
            provedor: 'OPENROUTER',
            apiKey: 'sk-or-v1-chave-invalida-000000',
          },
        });

        expect(res.statusCode).toBe(401);
        const body = JSON.parse(res.body);
        expect(body.sucesso).toBe(false);
        expect(body.message).toContain('inválida');
        expect(body.message).toContain('https://openrouter.ai/keys');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('callOpenRouterApi (chat completions)', () => {
    it('deve usar {OPENROUTER_BASE_URL}/chat/completions, headers do ambiente e corpo OpenAI-compatible', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        respostaOpenAiCompativel(
          JSON.stringify({
            descricao: 'Café da manhã',
            valor: 18.5,
            dataMovimento: '2026-10-21',
            natureza: 'DESPESA',
            isPagamentoFatura: false,
            confianca: 0.97,
          })
        ) as any
      );
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as any;

      try {
        const parsed = await callOpenRouterApi(
          'sk-or-v1-chave-servico-1234567890',
          'deepseek/deepseek-chat',
          'PROMPT DE SISTEMA',
          'Paguei 18,50 no café'
        );

        expect(parsed.descricao).toBe('Café da manhã');
        expect(parsed.valor).toBe(18.5);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe(`${config.baseUrl}/chat/completions`);
        expect(opts.method).toBe('POST');
        expect(opts.headers.Authorization).toBe('Bearer sk-or-v1-chave-servico-1234567890');
        expect(opts.headers['HTTP-Referer']).toBe(config.httpReferer);
        expect(opts.headers['X-Title']).toBe(config.xTitle);
        expect(opts.headers['Content-Type']).toBe('application/json');

        const body = JSON.parse(opts.body);
        expect(body.response_format).toEqual({ type: 'json_object' });
        expect(body.model).toBe('deepseek/deepseek-chat');
        expect(body.model).toContain('/');
        expect(body.temperature).toBe(0.1);
        expect(body.messages[0].role).toBe('system');
        expect(body.messages[1].content).toContain('Paguei 18,50 no café');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('deve normalizar modelo inválido/sem vendor para deepseek/deepseek-chat', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          respostaOpenAiCompativel(
            JSON.stringify({
              descricao: 'Uber',
              valor: 25,
              dataMovimento: '2026-10-21',
              natureza: 'DESPESA',
              isPagamentoFatura: false,
              confianca: 0.9,
            })
          ) as any
        );
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as any;

      try {
        await callOpenRouterApi('sk-or-v1-chave-1234567890', 'deepseek-chat', 'SYS', 'Uber 25');

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.model).toBe(MODELO_OPENROUTER_PADRAO);
        expect(body.model).toBe('deepseek/deepseek-chat');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('POST /api/ia/parse (provedor OPENROUTER)', () => {
    it('deve despachar para o OpenRouter e devolver o lançamento estruturado', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          respostaOpenAiCompativel(
            JSON.stringify({
              descricao: 'Assinatura Streaming',
              valor: 49.9,
              dataMovimento: '2026-10-21',
              natureza: 'DESPESA',
              contaId: null,
              contaNomeSugerida: null,
              categoriaId: null,
              categoriaNomeSugerida: 'Lazer',
              isPagamentoFatura: false,
              parcelasTotal: null,
              parcelaAtual: null,
              observacao: null,
              confianca: 0.95,
            })
          ) as any
        );
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as any;

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/ia/parse',
          cookies: { token: tokenAuth },
          payload: {
            texto: 'Assinatura de streaming R$ 49,90',
            modo: 'API_PROPRIA',
            provedor: 'OPENROUTER',
            modelo: 'deepseek/deepseek-chat',
            apiKey: 'sk-or-v1-chave-parse-1234567890',
          },
        });

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.provedor).toBe('OPENROUTER');
        expect(body.aviso).toBeUndefined();
        expect(body.lancamento.descricao).toBe('Assinatura Streaming');
        expect(body.lancamento.valor).toBe(49.9);

        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe(`${config.baseUrl}/chat/completions`);
        expect(JSON.parse(opts.body).model).toBe('deepseek/deepseek-chat');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('deve recusar OPENAI explicitamente (HTTP 400) em vez de cair silenciosamente no Gemini', async () => {
      const fetchMock = vi.fn();
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as any;

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/ia/parse',
          cookies: { token: tokenAuth },
          payload: {
            texto: 'Café R$ 10,00',
            modo: 'API_PROPRIA',
            provedor: 'OPENAI',
            apiKey: 'sk-proj-chave-openai-1234567890',
          },
        });

        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.message).toContain('OPENAI ainda não suportado neste fluxo');
        expect(body.message).toContain('GEMINI, DEEPSEEK ou OPENROUTER');
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
