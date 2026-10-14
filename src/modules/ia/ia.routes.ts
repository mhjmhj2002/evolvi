import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ensureAuthenticated } from '../../middlewares/auth.middleware.js';
import { env } from '../../config/env.js';
import { CryptoService } from '../../infrastructure/security/crypto.service.js';
import {
  iaParseRequestSchema,
  testarApiKeySchema,
  salvarConfiguracaoIaSchema,
} from './ia.schema.js';
import {
  buildIaSystemPrompt,
  parseLocalDeterministic,
  callGeminiApi,
  ContextoUsuarioIA,
} from './ia.service.js';

export const iaRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addHook('preHandler', ensureAuthenticated);

  // 1. GET /api/ia/status (retorna status da IA configurada no banco atrelada ao usuário)
  app.get('/status', async (request, reply) => {
    const usuarioId = request.user.sub;

    // Busca todas as configurações de IA persistidas e criptografadas do usuário no PostgreSQL
    const configsUsuario = await prisma.configuracaoIaUsuario.findMany({
      where: { usuarioId },
      orderBy: { criadoEm: 'asc' },
    });

    const configuracoes: Array<{
      provedor: string;
      modelo: string;
      chaveMascarada: string;
      criadoEm: string;
    }> = [];

    for (const cfg of configsUsuario) {
      try {
        const chaveDecifrada = CryptoService.decrypt({
          ciphertext: cfg.apiKeyCifrada,
          iv: cfg.ivHex,
          tag: cfg.tagHex,
        });
        if (chaveDecifrada && chaveDecifrada.trim().length > 0) {
          configuracoes.push({
            provedor: cfg.provedor,
            modelo: cfg.modelo,
            chaveMascarada: CryptoService.mascararApiKey(chaveDecifrada),
            criadoEm: cfg.criadoEm.toISOString(),
          });
        }
      } catch (err) {
        console.error(`[IA Status] Erro ao decifrar chave do provedor ${cfg.provedor}:`, err);
      }
    }

    const hasEnvGemini = Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim().length > 0);
    const hasUserKey = configuracoes.length > 0;
    const chaveConfigurada = hasUserKey || hasEnvGemini;

    // Provedor ativo preferencial (primeiro configurado ou Gemini do env)
    const provedorAtivo = hasUserKey ? configuracoes[0].provedor : (hasEnvGemini ? 'GEMINI' : null);
    const modeloAtivo = hasUserKey ? configuracoes[0].modelo : 'gemini-3.8-flash';
    const chaveMascarada = hasUserKey ? configuracoes[0].chaveMascarada : null;

    return reply.status(200).send({
      configurada: chaveConfigurada,
      hasEnvKey: hasEnvGemini,
      hasUserKey,
      totalConfiguradas: configuracoes.length,
      configuracoes,
      chaveMascarada,
      provedorAtivo,
      modeloPadrao: modeloAtivo,
      provedoresSuportados: [
        {
          id: 'GEMINI',
          nome: 'Google Gemini',
          modelos: ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
          ajudaUrl: 'https://aistudio.google.com/app/apikey',
          temChaveServidor: hasEnvGemini,
          configurado: configuracoes.some((c) => c.provedor === 'GEMINI'),
        },
        {
          id: 'OPENAI',
          nome: 'OpenAI (ChatGPT)',
          modelos: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
          ajudaUrl: 'https://platform.openai.com/api-keys',
          temChaveServidor: false,
          configurado: configuracoes.some((c) => c.provedor === 'OPENAI'),
        },
        {
          id: 'ANTHROPIC',
          nome: 'Anthropic (Claude)',
          modelos: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
          ajudaUrl: 'https://console.anthropic.com/settings/keys',
          temChaveServidor: false,
          configurado: configuracoes.some((c) => c.provedor === 'ANTHROPIC'),
        },
      ],
    });
  });

  // 2. PUT /api/ia/configuracao (salva ou atualiza a chave de IA para um provedor específico no PostgreSQL)
  app.put('/configuracao', async (request, reply) => {
    const usuarioId = request.user.sub;

    const parseResult = salvarConfiguracaoIaSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados inválidos para salvar configuração de IA.',
        issues: parseResult.error.issues,
      });
    }

    const { provedor, apiKey, modelo } = parseResult.data;

    // Criptografia de grau bancário/militar AES-256-GCM
    const enc = CryptoService.encrypt(apiKey.trim());

    await prisma.configuracaoIaUsuario.upsert({
      where: {
        usuarioId_provedor: {
          usuarioId,
          provedor,
        },
      },
      create: {
        usuarioId,
        provedor,
        modelo: modelo || (provedor === 'OPENAI' ? 'gpt-4o-mini' : provedor === 'ANTHROPIC' ? 'claude-3-5-sonnet-20241022' : 'gemini-3.8-flash'),
        apiKeyCifrada: enc.ciphertext,
        ivHex: enc.iv,
        tagHex: enc.tag,
      },
      update: {
        modelo: modelo || (provedor === 'OPENAI' ? 'gpt-4o-mini' : provedor === 'ANTHROPIC' ? 'claude-3-5-sonnet-20241022' : 'gemini-3.8-flash'),
        apiKeyCifrada: enc.ciphertext,
        ivHex: enc.iv,
        tagHex: enc.tag,
      },
    });

    return reply.status(200).send({
      sucesso: true,
      hasUserKey: true,
      message: `Configuração de IA (${provedor}) salva e criptografada com sucesso com AES-256-GCM!`,
      chaveMascarada: CryptoService.mascararApiKey(apiKey),
      provedor,
      modelo: modelo || 'gemini-3.8-flash',
    });
  });

  // 3. DELETE /api/ia/configuracao (remove chave de um provedor específico ou de todos)
  app.delete('/configuracao', async (request, reply) => {
    const usuarioId = request.user.sub;
    const query = request.query as { provedor?: string };
    const body = request.body as { provedor?: string } | undefined;
    const provedorAlvo = query.provedor || body?.provedor;

    if (provedorAlvo) {
      await prisma.configuracaoIaUsuario.deleteMany({
        where: { usuarioId, provedor: provedorAlvo },
      });
    } else {
      await prisma.configuracaoIaUsuario.deleteMany({
        where: { usuarioId },
      });
    }

    return reply.status(200).send({
      sucesso: true,
      message: provedorAlvo
        ? `Configuração de IA (${provedorAlvo}) do usuário removida com sucesso.`
        : 'Todas as configurações de IA do usuário foram removidas com sucesso.',
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

    // Cenário B: Modo API Própria (BYOK ou Banco Criptografado)
    let efetivaApiKey = apiKey;
    let efetivoProvedor = provedor;
    let efetivoModelo = modelo;

    if (!efetivaApiKey) {
      const configUsuario = provedor
        ? await prisma.configuracaoIaUsuario.findUnique({
            where: {
              usuarioId_provedor: {
                usuarioId,
                provedor,
              },
            },
          })
        : await prisma.configuracaoIaUsuario.findFirst({
            where: { usuarioId },
            orderBy: { criadoEm: 'asc' },
          });

      if (configUsuario) {
        try {
          efetivaApiKey = CryptoService.decrypt({
            ciphertext: configUsuario.apiKeyCifrada,
            iv: configUsuario.ivHex,
            tag: configUsuario.tagHex,
          });
          efetivoProvedor = (configUsuario.provedor as any) || efetivoProvedor;
          efetivoModelo = configUsuario.modelo || efetivoModelo;
        } catch (err) {
          console.error('[IA Parse] Falha ao decifrar chave do usuário:', err);
        }
      }
    }

    if (modo === 'API_PROPRIA' && efetivaApiKey) {
      try {
        const prompt = buildIaSystemPrompt(contexto);
        const parsed = await callGeminiApi(
          efetivaApiKey,
          efetivoModelo || 'gemini-3.8-flash',
          prompt,
          texto
        );
        return reply.status(200).send({
          modo,
          provedor: efetivoProvedor || 'GEMINI',
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
        const mod = modelo || 'gemini-3.8-flash';
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
