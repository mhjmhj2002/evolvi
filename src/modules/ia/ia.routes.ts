import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ensureAuthenticated } from '../../middlewares/auth.middleware.js';
import { env } from '../../config/env.js';
import { CryptoService } from '../../infrastructure/security/crypto.service.js';
import {
  iaParseRequestSchema,
  testarApiKeySchema,
  salvarConfiguracaoIaSchema,
  queryConsumoIaSchema,
} from './ia.schema.js';
import { VERSAO_TABELA_PRECOS_IA } from '../../config/tabela-precos-ia.js';
import {
  buildIaSystemPrompt,
  parseLocalDeterministic,
  callGeminiApi,
  callDeepSeekApi,
  callOpenRouterApi,
  ContextoUsuarioIA,
} from './ia.service.js';
import { UsoIaService, tokensDeUsageGemini } from './uso-ia.service.js';
import { obterCapacidadeMedia } from './capacidades-media.js';
import { IaMediasConsolidadasService } from './ia-medias-consolidadas.service.js';
import {
  MODELO_OPENROUTER_PADRAO,
  ModeloIaInvalidoError,
  mensagemProvedorNaoSuportado,
  modeloPadraoPorProvedor,
  montarHeadersOpenRouter,
  montarUrlOpenRouter,
  normalizarModeloOpenRouter,
  provedorSuportadoNoFluxo,
  validarModeloIa,
} from './openrouter.config.js';

export const iaRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addHook('preHandler', ensureAuthenticated);

  // 1. GET /api/ia/status (retorna status da IA configurada no banco atrelada ao usuário)
  app.get('/status', async (request, reply) => {
    const usuarioId = request.user.sub;

    // Busca todas as configurações de IA persistidas e criptografadas do usuário no PostgreSQL
    // Ordena pela mais recentemente atualizada/usada primeiro
    const configsUsuario = await prisma.configuracaoIaUsuario.findMany({
      where: { usuarioId },
      orderBy: { atualizadoEm: 'desc' },
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
    const hasEnvOpenRouter = Boolean(
      env.OPENROUTER_API_KEY && env.OPENROUTER_API_KEY.trim().length > 0
    );
    const hasUserKey = configuracoes.length > 0;
    const chaveConfigurada = hasUserKey || hasEnvGemini || hasEnvOpenRouter;

    // Provedor ativo preferencial (primeiro configurado ou Gemini do env)
    const provedorAtivo = hasUserKey ? configuracoes[0].provedor : (hasEnvGemini ? 'GEMINI' : null);
    const modeloAtivo = hasUserKey
      ? configuracoes[0].modelo || modeloPadraoPorProvedor(configuracoes[0].provedor)
      : modeloPadraoPorProvedor(provedorAtivo);
    const chaveMascarada = hasUserKey ? configuracoes[0].chaveMascarada : null;

    // Capacidades de mídia derivadas da fonte única (IA_CAPACIDADES_MEDIA)
    const capacidades = (provedor: string) => {
      const cap = obterCapacidadeMedia(provedor);
      return {
        suportaImagens: cap?.suportaImagens ?? false,
        suportaPdfsNaoEstruturados: cap?.suportaPdfsNaoEstruturados ?? false,
        descricaoMidia: cap?.descricao ?? null,
      };
    };

    const modelosGemini = [
      'gemini-3.8-flash',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-1.5-pro',
    ];
    const modelosDeepSeek = ['deepseek-chat', 'deepseek-reasoner'];
    const modelosOpenAi = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];
    const modelosAnthropic = ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'];
    const modelosOpenRouter = [
      MODELO_OPENROUTER_PADRAO,
      'anthropic/claude-3.5-sonnet',
      'openai/gpt-4o',
      'meta-llama/llama-3.3-70b-instruct',
    ];

    return reply.status(200).send({
      configurada: chaveConfigurada,
      hasEnvKey: hasEnvGemini,
      hasEnvKeyOpenRouter: hasEnvOpenRouter,
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
          modelos: modelosGemini,
          modeloPadrao: modelosGemini[0],
          ...capacidades('GEMINI'),
          ajudaUrl: 'https://aistudio.google.com/app/apikey',
          temChaveServidor: hasEnvGemini,
          configurado: configuracoes.some((c) => c.provedor === 'GEMINI'),
          suportadoNoFluxo: provedorSuportadoNoFluxo('GEMINI'),
        },
        {
          id: 'DEEPSEEK',
          nome: 'DeepSeek',
          modelos: modelosDeepSeek,
          modeloPadrao: modelosDeepSeek[0],
          ...capacidades('DEEPSEEK'),
          ajudaUrl: 'https://platform.deepseek.com/api_keys',
          temChaveServidor: false,
          configurado: configuracoes.some((c) => c.provedor === 'DEEPSEEK'),
          suportadoNoFluxo: provedorSuportadoNoFluxo('DEEPSEEK'),
        },
        {
          id: 'OPENAI',
          nome: 'OpenAI (ChatGPT)',
          modelos: modelosOpenAi,
          modeloPadrao: modeloPadraoPorProvedor('OPENAI'),
          ...capacidades('OPENAI'),
          ajudaUrl: 'https://platform.openai.com/api-keys',
          temChaveServidor: false,
          configurado: configuracoes.some((c) => c.provedor === 'OPENAI'),
          suportadoNoFluxo: provedorSuportadoNoFluxo('OPENAI'),
        },
        {
          id: 'ANTHROPIC',
          nome: 'Anthropic (Claude)',
          modelos: modelosAnthropic,
          modeloPadrao: modelosAnthropic[0],
          ...capacidades('ANTHROPIC'),
          ajudaUrl: 'https://console.anthropic.com/settings/keys',
          temChaveServidor: false,
          configurado: configuracoes.some((c) => c.provedor === 'ANTHROPIC'),
          suportadoNoFluxo: provedorSuportadoNoFluxo('ANTHROPIC'),
        },
        {
          id: 'OPENROUTER',
          nome: 'OpenRouter',
          modelos: modelosOpenRouter,
          modeloPadrao: MODELO_OPENROUTER_PADRAO,
          ...capacidades('OPENROUTER'),
          ajudaUrl: 'https://openrouter.ai/keys',
          temChaveServidor: hasEnvOpenRouter,
          configurado: configuracoes.some((c) => c.provedor === 'OPENROUTER'),
          suportadoNoFluxo: provedorSuportadoNoFluxo('OPENROUTER'),
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

    const { provedor, apiKey } = parseResult.data;

    // Modelo efetivamente persistido: normaliza `vendor/model` no OpenRouter,
    // valida tamanho máximo (400 sem truncar) e nunca devolve o default do Gemini
    // quando o provedor é outro.
    let modeloPersistido: string;
    try {
      modeloPersistido =
        validarModeloIa(provedor, parseResult.data.modelo) || modeloPadraoPorProvedor(provedor);
    } catch (err) {
      if (err instanceof ModeloIaInvalidoError) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err.message,
        });
      }
      throw err;
    }

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
        modelo: modeloPersistido,
        apiKeyCifrada: enc.ciphertext,
        ivHex: enc.iv,
        tagHex: enc.tag,
      },
      update: {
        modelo: modeloPersistido,
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
      modelo: modeloPersistido,
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
      // Provedores ainda não implementados neste fluxo NÃO caem silenciosamente no Gemini.
      const provedorParaFluxo = (efetivoProvedor || 'GEMINI').trim().toUpperCase();
      if (!provedorSuportadoNoFluxo(provedorParaFluxo)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: mensagemProvedorNaoSuportado(provedorParaFluxo),
        });
      }

      // Modelo inválido (ex.: acima de 60 caracteres) retorna 400 claro, sem truncamento.
      let modeloParaFluxo: string;
      try {
        modeloParaFluxo =
          validarModeloIa(provedorParaFluxo, efetivoModelo) ||
          modeloPadraoPorProvedor(provedorParaFluxo);
      } catch (err) {
        if (err instanceof ModeloIaInvalidoError) {
          return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: err.message,
          });
        }
        throw err;
      }

      try {
        const prompt = buildIaSystemPrompt(contexto);
        let parsed: any;
        // TASK-49: telemetria de consumo — 1 registro por chamada de IA
        const opcoesTelemetria = { usuarioId, funcionalidade: 'CATEGORIZACAO' as const };

        if (provedorParaFluxo === 'DEEPSEEK') {
          parsed = await callDeepSeekApi(
            efetivaApiKey,
            modeloParaFluxo,
            prompt,
            texto,
            opcoesTelemetria
          );
        } else if (provedorParaFluxo === 'OPENROUTER') {
          parsed = await callOpenRouterApi(
            efetivaApiKey,
            modeloParaFluxo,
            prompt,
            texto,
            opcoesTelemetria
          );
        } else {
          parsed = await callGeminiApi(
            efetivaApiKey,
            modeloParaFluxo,
            prompt,
            texto,
            opcoesTelemetria
          );
        }
        return reply.status(200).send({
          modo,
          provedor: provedorParaFluxo,
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
    const usuarioId = request.user.sub;

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
        let res!: Response;
        let tokensValidacao = { tokensPrompt: 0, tokensResposta: 0, tokensTotal: 0 };
        const inicioValidacao = Date.now();

        for (let tentativa = 0; tentativa < 3; tentativa++) {
          res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: 'Responda OK' }] }]
            }),
          });
          if (res.status !== 503 && res.status !== 429) break;
          await new Promise((r) => setTimeout(r, 1000 * (tentativa + 1)));
        }

        // TASK-49: a validação de chave é uma chamada real de IA e consome tokens;
        // registramos exatamente 1 linha em uso_ia_logs (sucesso, sobrecarga ou falha).
        try {
          const payload: any = await res.clone().json();
          tokensValidacao = tokensDeUsageGemini(payload?.usageMetadata);
        } catch {
          // Sem usage disponível na validação: registra 0 tokens
        }

        const sobrecarga = res.status === 503 || res.status === 429;
        await UsoIaService.registrar({
          usuarioId,
          funcionalidade: 'OUTROS',
          provedor: 'GEMINI',
          modelo: mod,
          tokensPrompt: tokensValidacao.tokensPrompt,
          tokensResposta: tokensValidacao.tokensResposta,
          tokensTotal: tokensValidacao.tokensTotal,
          duracaoMs: Date.now() - inicioValidacao,
          status: res.ok || sobrecarga ? 'SUCESSO' : 'FALHA',
          mensagemErro: res.ok || sobrecarga ? null : `Validação de chave Gemini falhou (HTTP ${res.status})`,
        });

        // 503/429: a chave foi aceita, apenas o modelo está sobrecarregado/limitado.
        if (res.status === 503 || res.status === 429) {
          return reply.status(200).send({
            sucesso: true,
            message: `Chave aceita pelo Google, mas o modelo "${mod}" está sobrecarregado no momento (${res.status}). Tente novamente em instantes ou escolha outro modelo.`,
          });
        }

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

    if (provedor === 'DEEPSEEK') {
      try {
        const res = await fetch('https://api.deepseek.com/models', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });

        if (!res.ok) {
          const errBody = await res.text();
          return reply.status(400).send({
            sucesso: false,
            message: `Erro na validação da chave DeepSeek (${res.status}): ${errBody}`,
          });
        }

        return reply.status(200).send({
          sucesso: true,
          message: 'Chave de API do DeepSeek validada com sucesso!',
        });
      } catch (err: any) {
        return reply.status(500).send({
          sucesso: false,
          message: `Falha ao conectar com o DeepSeek: ${err.message}`,
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

    if (provedor === 'OPENROUTER') {
      // Modelo normalizado (formato `vendor/model`); acima de 60 caracteres ⇒ 400 claro.
      let modeloOpenRouter: string;
      try {
        modeloOpenRouter = normalizarModeloOpenRouter(
          modelo || modeloPadraoPorProvedor('OPENROUTER')
        );
      } catch (err) {
        if (err instanceof ModeloIaInvalidoError) {
          return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: err.message,
          });
        }
        throw err;
      }

      try {
        const res = await fetch(montarUrlOpenRouter('/auth/key'), {
          method: 'GET',
          headers: montarHeadersOpenRouter(apiKey),
        });

        if (!res.ok) {
          const errBody = await res.text();
          return reply.status(401).send({
            sucesso: false,
            provedor,
            modelo: modeloOpenRouter,
            message:
              res.status === 401 || res.status === 403
                ? `Chave de API do OpenRouter inválida ou sem permissão (HTTP ${res.status}). Verifique sua chave em https://openrouter.ai/keys.`
                : `Erro na validação da chave OpenRouter (${res.status}): ${errBody}`,
          });
        }

        return reply.status(200).send({
          sucesso: true,
          provedor,
          modelo: modeloOpenRouter,
          message: 'Chave de API do OpenRouter validada com sucesso!',
        });
      } catch (err: any) {
        return reply.status(500).send({
          sucesso: false,
          message: `Falha ao conectar com o OpenRouter: ${err.message}`,
        });
      }
    }

    return reply.status(200).send({
      sucesso: true,
      message: `Chave configurada com sucesso para o provedor ${provedor}.`,
    });
  });

  // TASK-49: GET /api/ia/consumo — auditoria de gastos de IA (SEMPRE isolado por usuarioId)
  app.get('/consumo', async (request, reply) => {
    const usuarioId = request.user.sub;

    const queryParse = queryConsumoIaSchema.safeParse(request.query);
    if (!queryParse.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Parâmetros de consulta inválidos.',
        issues: queryParse.error.issues,
      });
    }

    const { dataInicio, dataFim, funcionalidade, provedor, page, limit } = queryParse.data;

    const filtroData: { gte?: Date; lte?: Date } = {};
    if (dataInicio) {
      filtroData.gte = new Date(`${dataInicio}T00:00:00.000Z`);
    }
    if (dataFim) {
      filtroData.lte = new Date(`${dataFim}T23:59:59.999Z`);
    }

    // Isolamento multi-tenant inviolável: usuarioId sempre presente no where
    const where: any = {
      usuarioId,
      ...(Object.keys(filtroData).length > 0 && { criadoEm: filtroData }),
      ...(funcionalidade && { funcionalidade }),
      ...(provedor && { provedor: provedor.trim().toUpperCase() }),
    };

    const [totais, porFuncionalidade, porProvedor, totalChamadas, chamadas] = await Promise.all([
      prisma.usoIaLog.aggregate({
        where,
        _count: { _all: true },
        _sum: { tokensPrompt: true, tokensResposta: true, tokensTotal: true, custoUsd: true, custoBrl: true },
        _avg: { duracaoMs: true },
      }),
      prisma.usoIaLog.groupBy({
        by: ['funcionalidade'],
        where,
        _count: { _all: true },
        _sum: { tokensTotal: true, custoUsd: true, custoBrl: true },
      }),
      prisma.usoIaLog.groupBy({
        by: ['provedor'],
        where,
        _count: { _all: true },
        _sum: { tokensTotal: true, custoUsd: true, custoBrl: true },
      }),
      prisma.usoIaLog.count({ where }),
      prisma.usoIaLog.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          funcionalidade: true,
          provedor: true,
          modelo: true,
          tokensPrompt: true,
          tokensResposta: true,
          tokensTotal: true,
          custoUsd: true,
          custoBrl: true,
          cotacaoUsdBrl: true,
          duracaoMs: true,
          status: true,
          mensagemErro: true,
          loteId: true,
          arquivoId: true,
          criadoEm: true,
        },
      }),
    ]);

    const falhas = await prisma.usoIaLog.count({ where: { ...where, status: 'FALHA' } });

    const numero = (valor: unknown) => (valor === null || valor === undefined ? 0 : Number(valor));

    return reply.status(200).send({
      versaoTabelaPrecos: VERSAO_TABELA_PRECOS_IA,
      filtros: {
        dataInicio: dataInicio || null,
        dataFim: dataFim || null,
        funcionalidade: funcionalidade || null,
        provedor: provedor || null,
      },
      totais: {
        chamadas: totais._count._all,
        chamadasSucesso: totais._count._all - falhas,
        chamadasFalha: falhas,
        tokensPrompt: numero(totais._sum.tokensPrompt),
        tokensResposta: numero(totais._sum.tokensResposta),
        tokensTotal: numero(totais._sum.tokensTotal),
        custoUsd: numero(totais._sum.custoUsd),
        custoBrl: numero(totais._sum.custoBrl),
        duracaoMediaMs: Math.round(numero(totais._avg.duracaoMs)),
      },
      porFuncionalidade: porFuncionalidade.map((g) => ({
        funcionalidade: g.funcionalidade,
        chamadas: g._count._all,
        tokensTotal: numero(g._sum.tokensTotal),
        custoUsd: numero(g._sum.custoUsd),
        custoBrl: numero(g._sum.custoBrl),
      })),
      porProvedor: porProvedor.map((g) => ({
        provedor: g.provedor,
        chamadas: g._count._all,
        tokensTotal: numero(g._sum.tokensTotal),
        custoUsd: numero(g._sum.custoUsd),
        custoBrl: numero(g._sum.custoBrl),
      })),
      chamadasRecentes: {
        page,
        limit,
        total: totalChamadas,
        totalPages: Math.max(1, Math.ceil(totalChamadas / limit)),
        itens: chamadas,
      },
    });
  });

  // 7. GET /api/ia/medias-consolidadas (TASK-52 — médias consolidadas de custo e tempo por IA)
  app.get('/medias-consolidadas', async (_request, reply) => {
    const medias = await IaMediasConsolidadasService.listarMediasConsolidadas();
    return reply.status(200).send({
      itens: medias,
      total: medias.length,
    });
  });
};

