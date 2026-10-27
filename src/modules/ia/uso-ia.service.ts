import { prisma } from '../../infrastructure/database/prisma.js';
import {
  buscarPrecoModeloIa,
  normalizarProvedorIa,
  obterCotacaoUsdBrl,
  VERSAO_TABELA_PRECOS_IA,
} from '../../config/tabela-precos-ia.js';

/** Funcionalidades de IA rastreadas em `uso_ia_logs`. */
export type FuncionalidadeUsoIa =
  | 'EXTRACAO_EXTRATO'
  | 'CATEGORIZACAO'
  | 'RECLASSIFICACAO'
  | 'CHAT'
  | 'OUTROS';

export type StatusUsoIa = 'SUCESSO' | 'FALHA';

/** Contagem de tokens devolvida pelo provedor (normalizada). */
export interface TokensIa {
  tokensPrompt: number;
  tokensResposta: number;
  tokensTotal: number;
}

/** Resultado do cálculo puro de custo (sem acesso a banco). */
export interface CustoIaCalculado {
  /** `true` quando o preço do modelo é conhecido na tabela versionada. */
  precoConhecido: boolean;
  custoUsd: number | null;
  custoBrl: number | null;
  cotacaoUsdBrl: number;
  /** Aviso emitido quando o modelo não está na tabela de preços. */
  aviso?: string;
}

/** Entrada de `UsoIaService.registrar`. */
export interface RegistroUsoIaInput {
  usuarioId: string;
  funcionalidade: FuncionalidadeUsoIa;
  provedor: string;
  modelo: string;
  tokensPrompt?: number;
  tokensResposta?: number;
  tokensTotal?: number;
  duracaoMs?: number;
  status?: StatusUsoIa;
  mensagemErro?: string | null;
  loteId?: string | null;
  arquivoId?: string | null;
  /** Cotação USD→BRL a registrar; quando omitida usa a cotação configurada. */
  cotacaoUsdBrl?: number;
}

const CASAS_DECIMAIS_CUSTO = 6;

function arredondar(valor: number, casas: number): number {
  const fator = 10 ** casas;
  return Math.round((valor + Number.EPSILON) * fator) / fator;
}

function inteiroSeguro(valor: unknown): number {
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * Normaliza os contadores de tokens de uma resposta de provedor.
 * Aceita tanto o formato Gemini (`promptTokenCount`/`candidatesTokenCount`)
 * quanto o formato OpenAI-compatible (`prompt_tokens`/`completion_tokens`).
 */
export function normalizarTokensIa(
  usage?: {
    tokensPrompt?: number;
    tokensResposta?: number;
    tokensTotal?: number;
  } | null
): TokensIa {
  const tokensPrompt = inteiroSeguro(usage?.tokensPrompt);
  const tokensResposta = inteiroSeguro(usage?.tokensResposta);
  const totalInformado = usage?.tokensTotal;
  const tokensTotal =
    totalInformado === undefined || totalInformado === null
      ? tokensPrompt + tokensResposta
      : inteiroSeguro(totalInformado) || tokensPrompt + tokensResposta;

  return { tokensPrompt, tokensResposta, tokensTotal };
}

/**
 * Cálculo PURO de custo de uma chamada de IA (testável sem banco de dados).
 *
 * Regras:
 * - Preço lido da tabela versionada em USD por 1M tokens (entrada/saída).
 * - Modelo desconhecido ⇒ `custoUsd`/`custoBrl` nulos e `aviso` preenchido.
 * - `cotacaoUsdBrl` é sempre devolvida (mesmo com custo nulo) para auditoria.
 */
export function calcularCustoIa(params: {
  provedor: string;
  modelo: string;
  tokensPrompt?: number;
  tokensResposta?: number;
  cotacaoUsdBrl?: number;
}): CustoIaCalculado {
  const cotacaoInformada = Number(params.cotacaoUsdBrl);
  const cotacao = cotacaoInformada > 0 ? cotacaoInformada : obterCotacaoUsdBrl();

  const tokens = normalizarTokensIa({
    tokensPrompt: params.tokensPrompt,
    tokensResposta: params.tokensResposta,
  });

  const preco = buscarPrecoModeloIa(params.provedor, params.modelo);

  if (!preco) {
    return {
      precoConhecido: false,
      custoUsd: null,
      custoBrl: null,
      cotacaoUsdBrl: arredondar(cotacao, 4),
      aviso: `Modelo desconhecido na tabela de precos (v${VERSAO_TABELA_PRECOS_IA}): ${normalizarProvedorIa(
        params.provedor
      )}/${params.modelo || '(vazio)'} - custo registrado como nulo.`,
    };
  }

  const custoUsdBruto =
    (tokens.tokensPrompt / 1_000_000) * preco.usdPorMilhaoPrompt +
    (tokens.tokensResposta / 1_000_000) * preco.usdPorMilhaoResposta;

  return {
    precoConhecido: true,
    custoUsd: arredondar(custoUsdBruto, CASAS_DECIMAIS_CUSTO),
    custoBrl: arredondar(custoUsdBruto * cotacao, CASAS_DECIMAIS_CUSTO),
    cotacaoUsdBrl: arredondar(cotacao, 4),
  };
}

/** Extrator de tokens no formato OpenAI-compatible (`usage`). */
export function tokensDeUsageOpenAi(
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null
): TokensIa {
  return normalizarTokensIa({
    tokensPrompt: usage?.prompt_tokens,
    tokensResposta: usage?.completion_tokens,
    tokensTotal: usage?.total_tokens,
  });
}

/** Extrator de tokens no formato Google Gemini (`usageMetadata`). */
export function tokensDeUsageGemini(
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  } | null
): TokensIa {
  return normalizarTokensIa({
    tokensPrompt: usageMetadata?.promptTokenCount,
    tokensResposta: usageMetadata?.candidatesTokenCount,
    tokensTotal: usageMetadata?.totalTokenCount,
  });
}

/**
 * TASK-49 — Serviço de telemetria de consumo de IA.
 *
 * `registrar` grava EXATAMENTE 1 linha em `uso_ia_logs` por chamada de IA,
 * inclusive em falha (tokens 0, status FALHA e mensagemErro). Nunca lança:
 * erros de telemetria são engolidos para não interromper importação/classificação.
 */
export class UsoIaService {
  /**
   * Registra o consumo de uma chamada de IA.
   * @returns a linha criada, ou `null` quando a persistência falhar.
   */
  public static async registrar(input: RegistroUsoIaInput): Promise<{ id: string } | null> {
    try {
      if (!input?.usuarioId) {
        console.warn(
          `[UsoIaService] Registro descartado: usuarioId ausente (${input?.provedor}/${input?.modelo}).`
        );
        return null;
      }

      const status: StatusUsoIa = input.status === 'FALHA' ? 'FALHA' : 'SUCESSO';
      const emFalha = status === 'FALHA';

      const tokens = normalizarTokensIa({
        tokensPrompt: emFalha ? 0 : input.tokensPrompt,
        tokensResposta: emFalha ? 0 : input.tokensResposta,
        tokensTotal: emFalha ? 0 : input.tokensTotal,
      });

      const custo = calcularCustoIa({
        provedor: input.provedor,
        modelo: input.modelo,
        tokensPrompt: tokens.tokensPrompt,
        tokensResposta: tokens.tokensResposta,
        cotacaoUsdBrl: input.cotacaoUsdBrl,
      });

      if (!custo.precoConhecido) {
        console.warn(`[UsoIaService] ${custo.aviso}`);
      }

      const criado = await prisma.usoIaLog.create({
        data: {
          usuarioId: input.usuarioId,
          funcionalidade: input.funcionalidade,
          provedor: normalizarProvedorIa(input.provedor).slice(0, 30),
          modelo: (input.modelo || 'desconhecido').slice(0, 80),
          tokensPrompt: tokens.tokensPrompt,
          tokensResposta: tokens.tokensResposta,
          tokensTotal: tokens.tokensTotal,
          custoUsd: custo.custoUsd,
          custoBrl: custo.custoBrl,
          cotacaoUsdBrl: custo.cotacaoUsdBrl,
          duracaoMs: inteiroSeguro(input.duracaoMs),
          status,
          mensagemErro: emFalha
            ? input.mensagemErro || 'Falha não detalhada na chamada de IA.'
            : null,
          loteId: input.loteId || null,
          arquivoId: input.arquivoId || null,
        },
        select: { id: true },
      });

      return criado;
    } catch (err) {
      // Telemetria NUNCA deve quebrar o fluxo de negócio.
      console.warn(
        `[UsoIaService] Falha ao registrar consumo de IA (${input?.provedor}/${input?.modelo}):`,
        err instanceof Error ? err.message : err
      );
      return null;
    }
  }

  /**
   * Wrapper utilitário: executa uma chamada de IA cronometrando a latência e
   * registrando EXATAMENTE 1 linha em `uso_ia_logs` (sucesso ou falha).
   *
   * `extrairTokens` lê a contagem de tokens do retorno da execução, permitindo
   * instrumentar clientes com formatos de resposta distintos.
   */
  public static async registrarChamada<T>(params: {
    usuarioId?: string | null;
    funcionalidade: FuncionalidadeUsoIa;
    provedor: string;
    modelo: string;
    loteId?: string | null;
    arquivoId?: string | null;
    execucao: () => Promise<T>;
    extrairTokens?: (resultado: T) => Partial<TokensIa> | null | undefined;
    /**
     * TASK-50: handoff explícito do id do log criado (`uso_ia_logs`) para permitir
     * a correlação determinística com `tentativas_arquivo_importacao`.
     */
    aoRegistrar?: (logId: string | null) => void;
  }): Promise<T> {
    const inicio = Date.now();

    let resultado: T;
    try {
      resultado = await params.execucao();
    } catch (err) {
      // Falha REAL da chamada de IA: registra 1 log FALHA e propaga o erro original.
      const duracaoMs = Date.now() - inicio;
      try {
        if (params.usuarioId) {
          const registro = await UsoIaService.registrar({
            usuarioId: params.usuarioId,
            funcionalidade: params.funcionalidade,
            provedor: params.provedor,
            modelo: params.modelo,
            tokensPrompt: 0,
            tokensResposta: 0,
            tokensTotal: 0,
            duracaoMs,
            status: 'FALHA',
            mensagemErro: err instanceof Error ? err.message : String(err),
            loteId: params.loteId,
            arquivoId: params.arquivoId,
          });
          params.aoRegistrar?.(registro?.id ?? null);
        }
      } catch (errTelemetria) {
        // Telemetria NUNCA substitui nem mascara o erro de negócio.
        console.warn(
          '[UsoIaService] Falha ao registrar telemetria de falha (ignorada):',
          errTelemetria instanceof Error ? errTelemetria.message : errTelemetria
        );
      }

      throw err;
    }

    // A chamada de IA teve SUCESSO: a partir daqui qualquer erro é apenas de
    // telemetria e jamais deve interromper importação/classificação.
    try {
      if (params.usuarioId) {
        const duracaoMs = Date.now() - inicio;
        const tokens = params.extrairTokens?.(resultado);
        const registro = await UsoIaService.registrar({
          usuarioId: params.usuarioId,
          funcionalidade: params.funcionalidade,
          provedor: params.provedor,
          modelo: params.modelo,
          tokensPrompt: tokens?.tokensPrompt,
          tokensResposta: tokens?.tokensResposta,
          tokensTotal: tokens?.tokensTotal,
          duracaoMs,
          status: 'SUCESSO',
          loteId: params.loteId,
          arquivoId: params.arquivoId,
        });
        params.aoRegistrar?.(registro?.id ?? null);
      }
    } catch (errTelemetria) {
      console.warn(
        '[UsoIaService] Falha ao registrar telemetria de sucesso (ignorada):',
        errTelemetria instanceof Error ? errTelemetria.message : errTelemetria
      );
    }

    return resultado;
  }
}

export { VERSAO_TABELA_PRECOS_IA };
