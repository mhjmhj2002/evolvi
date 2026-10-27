import { env } from './env.js';

/**
 * TASK-49 — Tabela de preços de IA (config versionada).
 *
 * Preços em USD por 1 MILHÃO de tokens, separados em entrada (prompt) e
 * saída (resposta), por provedor/modelo. A versão deve ser incrementada
 * sempre que algum preço for alterado, pois ela é gravada no relatório de
 * consumo (`GET /api/ia/consumo`) para fins de auditoria.
 */
export const VERSAO_TABELA_PRECOS_IA = '2026-10-v1';

/** Cotação USD→BRL padrão, usada quando nenhuma cotação é informada/env. */
export const COTACAO_USD_BRL_PADRAO = 5.5;

export interface PrecoModeloIa {
  /** USD por 1 milhão de tokens de entrada (prompt). */
  usdPorMilhaoPrompt: number;
  /** USD por 1 milhão de tokens de saída (resposta). */
  usdPorMilhaoResposta: number;
}

/**
 * Modelos efetivamente usados pelo código (ver `src/modules/ia/ia.service.ts` e
 * `src/modules/importacao/worker/ia-extrator.client.ts`) mais os modelos
 * disponíveis na validação de configuração de IA.
 */
export const TABELA_PRECOS_IA: Record<string, Record<string, PrecoModeloIa>> = {
  GEMINI: {
    'gemini-3.8-flash': { usdPorMilhaoPrompt: 0.3, usdPorMilhaoResposta: 2.5 },
    'gemini-2.5-flash': { usdPorMilhaoPrompt: 0.3, usdPorMilhaoResposta: 2.5 },
    'gemini-2.0-flash': { usdPorMilhaoPrompt: 0.1, usdPorMilhaoResposta: 0.4 },
    'gemini-1.5-flash': { usdPorMilhaoPrompt: 0.075, usdPorMilhaoResposta: 0.3 },
    'gemini-1.5-pro': { usdPorMilhaoPrompt: 1.25, usdPorMilhaoResposta: 5.0 },
  },
  OPENAI: {
    'gpt-4o': { usdPorMilhaoPrompt: 2.5, usdPorMilhaoResposta: 10.0 },
    'gpt-4o-mini': { usdPorMilhaoPrompt: 0.15, usdPorMilhaoResposta: 0.6 },
    'gpt-4-turbo': { usdPorMilhaoPrompt: 10.0, usdPorMilhaoResposta: 30.0 },
  },
  DEEPSEEK: {
    'deepseek-chat': { usdPorMilhaoPrompt: 0.27, usdPorMilhaoResposta: 1.1 },
    'deepseek-reasoner': { usdPorMilhaoPrompt: 0.55, usdPorMilhaoResposta: 2.19 },
  },
  ANTHROPIC: {
    'claude-3-5-sonnet-20241022': { usdPorMilhaoPrompt: 3.0, usdPorMilhaoResposta: 15.0 },
    'claude-3-5-haiku-20241022': { usdPorMilhaoPrompt: 0.8, usdPorMilhaoResposta: 4.0 },
  },
  // O extrator usa o rótulo CLAUDE em IA_CAPACIDADES_MEDIA; mantemos o alias.
  CLAUDE: {
    'claude-3-5-sonnet-20241022': { usdPorMilhaoPrompt: 3.0, usdPorMilhaoResposta: 15.0 },
    'claude-3-5-haiku-20241022': { usdPorMilhaoPrompt: 0.8, usdPorMilhaoResposta: 4.0 },
  },
  OPENROUTER: {
    'deepseek/deepseek-chat': { usdPorMilhaoPrompt: 0.27, usdPorMilhaoResposta: 1.1 },
    'anthropic/claude-3.5-sonnet': { usdPorMilhaoPrompt: 3.0, usdPorMilhaoResposta: 15.0 },
    'openai/gpt-4o': { usdPorMilhaoPrompt: 2.5, usdPorMilhaoResposta: 10.0 },
    'meta-llama/llama-3.3-70b-instruct': { usdPorMilhaoPrompt: 0.12, usdPorMilhaoResposta: 0.3 },
  },
};

/** Índice interno com chaves normalizadas (provedor e modelo em minúsculas). */
const INDICE_PRECOS: Record<string, Record<string, PrecoModeloIa>> = Object.fromEntries(
  Object.entries(TABELA_PRECOS_IA).map(([provedor, modelos]) => [
    provedor.trim().toUpperCase(),
    Object.fromEntries(
      Object.entries(modelos).map(([modelo, preco]) => [modelo.trim().toLowerCase(), preco])
    ),
  ])
);

export function normalizarProvedorIa(provedor?: string | null): string {
  return (provedor || 'GEMINI').trim().toUpperCase();
}

export function normalizarModeloIa(modelo?: string | null): string {
  return (modelo || '').trim().toLowerCase();
}

/**
 * Busca o preço de um modelo. Retorna `null` quando o modelo é desconhecido
 * (nesse caso o custo NÃO é estimado — grava-se custo nulo + aviso).
 */
export function buscarPrecoModeloIa(
  provedor: string,
  modelo: string
): PrecoModeloIa | null {
  const prov = normalizarProvedorIa(provedor);
  const mod = normalizarModeloIa(modelo);
  return INDICE_PRECOS[prov]?.[mod] ?? null;
}

/**
 * Cotação USD→BRL registrada (env `COTACAO_USD_BRL`), com fallback constante.
 */
export function obterCotacaoUsdBrl(): number {
  const cotacao = Number(env.COTACAO_USD_BRL);
  if (!Number.isFinite(cotacao) || cotacao <= 0) {
    return COTACAO_USD_BRL_PADRAO;
  }
  return cotacao;
}
