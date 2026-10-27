import { env } from '../../config/env.js';

/**
 * Configuração centralizada do provedor OpenRouter.
 *
 * Fonte única de URL base, headers de atribuição e modelo padrão, usada por:
 * - `src/modules/ia/ia.service.ts` (`callOpenRouterApi`)
 * - `src/modules/importacao/worker/ia-extrator.client.ts` (`chamarOpenRouterApi`)
 * - `src/modules/ia/ia.routes.ts` (`POST /testar-conexao` e `PUT /configuracao`)
 */

export const OPENROUTER_BASE_URL_PADRAO = 'https://openrouter.ai/api/v1';
export const OPENROUTER_HTTP_REFERER_PADRAO = 'http://localhost:5173';
export const OPENROUTER_X_TITLE_PADRAO = 'Evolvi Financeiro';

/** Modelo padrão do OpenRouter: obrigatoriamente no formato `vendor/model`. */
export const MODELO_OPENROUTER_PADRAO = 'deepseek/deepseek-chat';

/** Limite de tamanho aceito para o identificador de modelo (evita truncamento silencioso). */
export const TAMANHO_MAXIMO_MODELO_IA = 60;

export interface ConfigOpenRouter {
  /** Base URL da API (sem barra final), ex.: `https://openrouter.ai/api/v1`. */
  baseUrl: string;
  /** Header `HTTP-Referer` exigido para atribuição de app no OpenRouter. */
  httpReferer: string;
  /** Header `X-Title` (nome do app exibido no ranking do OpenRouter). */
  xTitle: string;
  /** Chave de servidor (env) usada como fallback quando o usuário não tem chave salva. */
  apiKeyServidor: string | null;
}

/** Erro de validação de modelo — as rotas HTTP traduzem para `400 Bad Request`. */
export class ModeloIaInvalidoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModeloIaInvalidoError';
  }
}

function textoLimpo(valor?: string | null): string {
  return (valor || '').trim();
}

/** Remove barras finais para permitir concatenar caminhos sem duplicar `/`. */
function semBarraFinal(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Lê a configuração do OpenRouter do ambiente, com defaults tolerantes
 * (variável vazia ou ausente ⇒ valor padrão).
 */
export function obterConfigOpenRouter(): ConfigOpenRouter {
  const baseUrl = semBarraFinal(textoLimpo(env.OPENROUTER_BASE_URL) || OPENROUTER_BASE_URL_PADRAO);

  const corsOrigin = textoLimpo(env.CORS_ORIGIN);
  const refererPadrao =
    corsOrigin && corsOrigin !== '*' ? semBarraFinal(corsOrigin) : OPENROUTER_HTTP_REFERER_PADRAO;
  const httpReferer = textoLimpo(env.OPENROUTER_HTTP_REFERER) || refererPadrao;

  const xTitle = textoLimpo(env.OPENROUTER_X_TITLE) || OPENROUTER_X_TITLE_PADRAO;
  const apiKeyServidor = textoLimpo(env.OPENROUTER_API_KEY) || null;

  return { baseUrl, httpReferer, xTitle, apiKeyServidor };
}

/**
 * Resolve a chave a usar: a do usuário (banco/BYOK) tem prioridade;
 * sem ela, cai para a chave de servidor do ambiente (paridade com GEMINI_API_KEY).
 */
export function resolverApiKeyOpenRouter(apiKeyUsuario?: string | null): string {
  const doUsuario = textoLimpo(apiKeyUsuario);
  if (doUsuario) return doUsuario;

  const { apiKeyServidor } = obterConfigOpenRouter();
  if (apiKeyServidor) return apiKeyServidor;

  throw new Error(
    'Nenhuma chave de API do OpenRouter disponível. Cadastre sua chave em https://openrouter.ai/keys ou configure OPENROUTER_API_KEY no servidor.'
  );
}

/**
 * Monta os headers obrigatórios para qualquer chamada ao OpenRouter.
 */
export function montarHeadersOpenRouter(apiKey?: string | null): Record<string, string> {
  const { httpReferer, xTitle } = obterConfigOpenRouter();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${resolverApiKeyOpenRouter(apiKey)}`,
    'HTTP-Referer': httpReferer,
    'X-Title': xTitle,
  };
}

/** Monta uma URL absoluta a partir da base URL configurada (ex.: `/chat/completions`). */
export function montarUrlOpenRouter(caminho: string): string {
  const { baseUrl } = obterConfigOpenRouter();
  const sufixo = caminho.startsWith('/') ? caminho : `/${caminho}`;
  return `${baseUrl}${sufixo}`;
}

/** Modelo efetivo usado nas chamadas (URL/body), já normalizado. */
export function normalizarModeloOpenRouter(modelo?: string | null): string {
  const bruto = textoLimpo(modelo);

  if (bruto.length > TAMANHO_MAXIMO_MODELO_IA) {
    throw new ModeloIaInvalidoError(
      `Modelo inválido: "${bruto.slice(0, 30)}..." excede o limite de ${TAMANHO_MAXIMO_MODELO_IA} caracteres. Informe um modelo no formato "vendor/model" (ex.: "${MODELO_OPENROUTER_PADRAO}").`
    );
  }

  // Sem identificador ou sem o prefixo `vendor/` ⇒ usa o padrão do projeto.
  if (!bruto || !bruto.includes('/')) {
    return MODELO_OPENROUTER_PADRAO;
  }

  return bruto;
}

/**
 * Valida/normaliza o modelo de QUALQUER provedor no momento da persistência.
 * Nunca trunca: acima do limite gera `ModeloIaInvalidoError` (HTTP 400 nas rotas).
 */
export function validarModeloIa(provedor: string, modelo?: string | null): string | null {
  const bruto = textoLimpo(modelo);
  if (bruto.length > TAMANHO_MAXIMO_MODELO_IA) {
    throw new ModeloIaInvalidoError(
      `Modelo inválido: "${bruto.slice(0, 30)}..." excede o limite de ${TAMANHO_MAXIMO_MODELO_IA} caracteres.`
    );
  }
  if (!bruto) return null;
  if (provedor.trim().toUpperCase() === 'OPENROUTER') {
    return normalizarModeloOpenRouter(bruto);
  }
  return bruto;
}

/** Modelo padrão por provedor, usado quando o usuário não informa um modelo. */
export function modeloPadraoPorProvedor(provedor?: string | null): string {
  switch ((provedor || '').trim().toUpperCase()) {
    case 'DEEPSEEK':
      return 'deepseek-chat';
    case 'OPENROUTER':
      return MODELO_OPENROUTER_PADRAO;
    case 'OPENAI':
      return 'gpt-4o-mini';
    case 'ANTHROPIC':
      return 'claude-3-5-sonnet-20241022';
    case 'GEMINI':
    default:
      return 'gemini-3.8-flash';
  }
}

/** Provedores já implementados no fluxo de parsing/extração. */
export const PROVEDORES_SUPORTADOS_NO_FLUXO = ['GEMINI', 'DEEPSEEK', 'OPENROUTER'] as const;

/**
 * Erro explícito para provedores ainda não implementados neste fluxo
 * (evita cair silenciosamente no Gemini).
 */
export function mensagemProvedorNaoSuportado(provedor?: string | null): string {
  const prov = (provedor || '').trim().toUpperCase() || 'DESCONHECIDO';
  return `O provedor ${prov} ainda não suportado neste fluxo, use GEMINI, DEEPSEEK ou OPENROUTER.`;
}

/** `true` quando o provedor pode ser despachado no fluxo de parsing/extração. */
export function provedorSuportadoNoFluxo(provedor?: string | null): boolean {
  const prov = (provedor || '').trim().toUpperCase();
  return (PROVEDORES_SUPORTADOS_NO_FLUXO as readonly string[]).includes(prov);
}
