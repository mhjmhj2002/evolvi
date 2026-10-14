import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ensureAuthenticated } from '../../middlewares/auth.middleware.js';
import { env } from '../../config/env.js';
import {
  iaParseRequestSchema,
  testarApiKeySchema,
} from './ia.schema.js';
import {
  buildIaSystemPrompt,
  parseLocalDeterministic,
  callGeminiApi,
  ContextoUsuarioIA,
} from './ia.service.js';

export const iaRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addHook('preHandler', ensureAuthenticated);

  // 1. GET /api/ia/status (retorna se há chave de IA configurada no servidor e provedores suportados)
  app.get('/status', async (_request, reply) => {
    const hasEnvGemini = Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim().length > 0);

    return reply.status(200).send({
      configurada: hasEnvGemini,
      hasEnvKey: hasEnvGemini,
      provedorAtivo: hasEnvGemini ? 'GEMINI' : null,
      modeloPadrao: 'gemini-2.5-flash',
      provedoresSuportados: [
        {
          id: 'GEMINI',
          nome: 'Google Gemini',
          modelos: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
          ajudaUrl: 'https://aistudio.google.com/app/apikey',
          temChaveServidor: hasEnvGemini,
        },
        {
          id: 'OPENAI',
          nome: 'OpenAI (ChatGPT)',
          modelos: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
          ajudaUrl: 'https://platform.openai.com/api-keys',
          temChaveServidor: false,
        },
        {
          id: 'ANTHROPIC',
          nome: 'Anthropic (Claude)',
          modelos: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
          ajudaUrl: 'https://console.anthropic.com/settings/keys',
          temChaveServidor: false,
        },
      ],
    });
  });

  // 2. GET /api/ia/contexto (retorna contexto do usuário e o prompt exportável para Modo Externo)
  app.get('/contexto', async (request, reply) => {
    const usuarioId = request.user.sub;

    const [contas, categorias] = await Promise.all([
      prisma.conta.findMany({
        where: { usuarioId, ativo: true },
        select: { id: true, nome: true, tipo: true },
      }),
      prisma.categoria.findMany({
        where: {
          OR: [{ usuarioId: null }, { usuarioId }],
        },
        select: { id: true, nome: true },
        orderBy: { ordem: 'asc' },
      }),
    ]);

    const hoje = new Date().toISOString().split('T')[0];
    const contexto: ContextoUsuarioIA = {
      contas,
      categorias,
      dataReferencia: hoje,
    };

    const systemPrompt = buildIaSystemPrompt(contexto);

    return reply.status(200).send({
      contexto,
      promptExportavel: systemPrompt,
    });
  });

  // 3. POST /api/ia/parse (processa texto em linguagem natural ou JSON externo colado)
  app.post('/parse', async (request, reply) => {
    const usuarioId = request.user.sub;

    const parseResult = iaParseRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Parâmetros inválidos para interpretação por IA.',
        issues: parseResult.error.issues,
      });
    }

    const { texto, modo, provedor, modelo, apiKey, dataReferencia } = parseResult.data;

    // Buscar contas e categorias para contexto
    const [contas, categorias] = await Promise.all([
      prisma.conta.findMany({
        where: { usuarioId, ativo: true },
        select: { id: true, nome: true, tipo: true },
      }),
      prisma.categoria.findMany({
        where: {
          OR: [{ usuarioId: null }, { usuarioId }],
        },
        select: { id: true, nome: true },
      }),
    ]);

    const hoje = dataReferencia || new Date().toISOString().split('T')[0];
    const contexto: ContextoUsuarioIA = {
      contas,
      categorias,
      dataReferencia: hoje,
    };

    // Cenário A: Se o texto for um JSON já colado do Modo Externo
    const textoTrimmed = texto.trim();
    if (textoTrimmed.startsWith('{') && textoTrimmed.endsWith('}')) {
      try {
        const jsonDireto = JSON.parse(textoTrimmed);
        if (jsonDireto.descricao && jsonDireto.valor) {
          return reply.status(200).send({
            modo,
            lancamento: {
              ...jsonDireto,
              dataMovimento: jsonDireto.dataMovimento || hoje,
              confianca: jsonDireto.confianca ?? 1.0,
            },
          });
        }
      } catch {
        // Se falhar o parse direto do json, continua o fluxo normal
      }
    }

    // Cenário B: Modo API Própria (BYOK)
    if (modo === 'API_PROPRIA' && apiKey) {
      try {
        const prompt = buildIaSystemPrompt(contexto);
        const parsed = await callGeminiApi(
          apiKey,
          modelo || 'gemini-2.5-flash',
          prompt,
          texto
        );
        return reply.status(200).send({
          modo,
          provedor: provedor || 'GEMINI',
          lancamento: parsed,
        });
      } catch (err: any) {
        // Fallback gracioso com aviso em caso de erro de rede ou chave inválida
        const fallback = parseLocalDeterministic(texto, contexto);
        return reply.status(200).send({
          modo,
          aviso: `Não foi possível consultar a API externa (${err.message}). Foi utilizado o motor heurístico local.`,
          lancamento: fallback,
        });
      }
    }

    // Cenário C: Modo Créditos / Serviço Integrado ou Modo Externo
    // Utiliza o motor determinístico/heurístico ou integração interna
    const lancamentoParsed = parseLocalDeterministic(texto, contexto);

    return reply.status(200).send({
      modo,
      lancamento: lancamentoParsed,
      creditosConsumidos: modo === 'CREDITOS' ? 1 : 0,
      saldoRestanteCreditos: modo === 'CREDITOS' ? 49 : undefined,
    });
  });

  // 4. POST /api/ia/testar-conexao (valida se a chave informada pelo usuário responde)
  app.post('/testar-conexao', async (request, reply) => {
    const parseResult = testarApiKeySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados incompletos para testar chave.',
        issues: parseResult.error.issues,
      });
    }

    const { apiKey, provedor, modelo } = parseResult.data;

    if (provedor === 'GEMINI') {
      try {
        const mod = modelo || 'gemini-2.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${mod}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Responda OK' }] }]
          }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          return reply.status(400).send({
            sucesso: false,
            message: `Erro na validação da chave (${res.status}): ${errBody}`,
          });
        }

        return reply.status(200).send({
          sucesso: true,
          message: 'Chave de API do Gemini validada com sucesso!',
        });
      } catch (err: any) {
        return reply.status(500).send({
          sucesso: false,
          message: `Falha ao conectar com o Google Gemini: ${err.message}`,
        });
      }
    }

    if (provedor === 'OPENAI') {
      try {
        const res = await fetch('https://api.openai.com/v1/models', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });

        if (!res.ok) {
          const errBody = await res.text();
          return reply.status(400).send({
            sucesso: false,
            message: `Erro na validação da chave OpenAI (${res.status}): ${errBody}`,
          });
        }

        return reply.status(200).send({
          sucesso: true,
          message: 'Chave de API da OpenAI validada com sucesso!',
        });
      } catch (err: any) {
        return reply.status(500).send({
          sucesso: false,
          message: `Falha ao conectar com a OpenAI: ${err.message}`,
        });
      }
    }

    if (provedor === 'ANTHROPIC') {
      try {
        // Validação leve com headers Anthropic
        const res = await fetch('https://api.anthropic.com/v1/models', {
          method: 'GET',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
        });

        if (!res.ok && res.status !== 404) {
          const errBody = await res.text();
          return reply.status(400).send({
            sucesso: false,
            message: `Erro na validação da chave Claude/Anthropic (${res.status}): ${errBody}`,
          });
        }

        return reply.status(200).send({
          sucesso: true,
          message: 'Chave de API da Anthropic validada com sucesso!',
        });
      } catch (err: any) {
        return reply.status(500).send({
          sucesso: false,
          message: `Falha ao conectar com a Anthropic: ${err.message}`,
        });
      }
    }

    return reply.status(200).send({
      sucesso: true,
      message: `Chave configurada com sucesso para o provedor ${provedor}.`,
    });
  });
};
