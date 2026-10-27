import { prisma } from '../../infrastructure/database/prisma.js';
import { env } from '../../config/env.js';
import { obterCotacaoUsdBrl, normalizarProvedorIa, normalizarModeloIa } from '../../config/tabela-precos-ia.js';
import { authEventBus, AuthEventBus, UsuarioAutenticadoEvent } from '../../infrastructure/events/auth-event-bus.js';
import {
  importacaoEventBus,
  ImportacaoEventBus,
  ImportacaoLoteConcluidoEvent,
} from '../../infrastructure/events/importacao-event-bus.js';

export interface IaMediaConsolidadaItem {
  provedor: string;
  modelo: string;
  custoUsdPor1kTokens: number;
  custoBrlPor1kTokens: number;
  segundosPor1kTokens: number;
  totalChamadas: number;
  janelaDias: number;
  cotacaoUsdBrl: number;
  isEstimativa: boolean;
  atualizadoEm: string;
}

/**
 * Fallbacks parametrizados via internet / env para quando não há amostras reais registradas.
 * Custo em USD por 1k tokens (média ponderada estimada prompt/output) e tempo em segundos por 1k tokens.
 */
interface FallbackConfig {
  usdPor1k: number;
  segPor1k: number;
}

const FALLBACKS_PADRAO: Record<string, Record<string, FallbackConfig>> = {
  GEMINI: {
    'gemini-3.8-flash': { usdPor1k: 0.00085, segPor1k: 0.65 },
    'gemini-2.5-flash': { usdPor1k: 0.00085, segPor1k: 0.65 },
    'gemini-2.0-flash': { usdPor1k: 0.00025, segPor1k: 0.55 },
    'gemini-1.5-flash': { usdPor1k: 0.00015, segPor1k: 0.50 },
    'gemini-1.5-pro': { usdPor1k: 0.00250, segPor1k: 1.20 },
  },
  OPENROUTER: {
    'deepseek/deepseek-chat': { usdPor1k: 0.00060, segPor1k: 0.85 },
    'anthropic/claude-3.5-sonnet': { usdPor1k: 0.00600, segPor1k: 1.50 },
    'openai/gpt-4o': { usdPor1k: 0.00500, segPor1k: 1.10 },
    'meta-llama/llama-3.3-70b-instruct': { usdPor1k: 0.00025, segPor1k: 0.70 },
  },
  DEEPSEEK: {
    'deepseek-chat': { usdPor1k: 0.00060, segPor1k: 0.85 },
    'deepseek-reasoner': { usdPor1k: 0.00120, segPor1k: 2.10 },
  },
  ANTHROPIC: {
    'claude-3-5-sonnet-20241022': { usdPor1k: 0.00600, segPor1k: 1.50 },
    'claude-3-5-haiku-20241022': { usdPor1k: 0.00150, segPor1k: 0.60 },
  },
  OPENAI: {
    'gpt-4o': { usdPor1k: 0.00500, segPor1k: 1.10 },
    'gpt-4o-mini': { usdPor1k: 0.00030, segPor1k: 0.50 },
  },
};

function obterChaveEnvFallback(provedor: string, modelo: string, sufixo: 'USD' | 'SEG'): string {
  const provSanitizado = provedor.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const modSanitizado = modelo.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return `IA_MEDIA_FALLBACK_${provSanitizado}_${modSanitizado}_${sufixo}_POR_1K`;
}

function obterFallbackModel(provedor: string, modelo: string): FallbackConfig {
  const provNorm = normalizarProvedorIa(provedor);
  const modNorm = normalizarModeloIa(modelo);

  // 1. Tenta ler direto do env se configurado
  const keyUsd = obterChaveEnvFallback(provNorm, modNorm, 'USD');
  const keySeg = obterChaveEnvFallback(provNorm, modNorm, 'SEG');

  const envUsd = process.env[keyUsd] ? Number(process.env[keyUsd]) : undefined;
  const envSeg = process.env[keySeg] ? Number(process.env[keySeg]) : undefined;

  const padrao = FALLBACKS_PADRAO[provNorm]?.[modNorm] || { usdPor1k: 0.001, segPor1k: 0.8 };

  return {
    usdPor1k: envUsd !== undefined && Number.isFinite(envUsd) ? envUsd : padrao.usdPor1k,
    segPor1k: envSeg !== undefined && Number.isFinite(envSeg) ? envSeg : padrao.segPor1k,
  };
}

export class IaMediasConsolidadasService {
  /**
   * Consolida as médias globais de IA nos últimos `janelaDias` (padrão 90)
   * a partir de `uso_ia_logs` agrupadas por `(provedor, modelo)`.
   * Realiza upsert idempotente na tabela `ia_medias_consolidadas`.
   */
  public static async consolidarMediasGlobais(): Promise<number> {
    const janelaDias = Number(env.IA_MEDIA_JANELA_DIAS) || 90;
    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - janelaDias);

    // 1. Busca logs com SUCESSO na janela
    const logs = await prisma.usoIaLog.findMany({
      where: {
        status: 'SUCESSO',
        criadoEm: { gte: dataLimite },
        tokensTotal: { gt: 0 },
      },
      select: {
        provedor: true,
        modelo: true,
        tokensTotal: true,
        custoUsd: true,
        cotacaoUsdBrl: true,
        duracaoMs: true,
      },
    });

    // Cotação de referência: última do log ou env
    let cotacaoReferencia = obterCotacaoUsdBrl();
    if (logs.length > 0 && logs[logs.length - 1].cotacaoUsdBrl) {
      cotacaoReferencia = Number(logs[logs.length - 1].cotacaoUsdBrl) || cotacaoReferencia;
    }

    // 2. Agrupa por provedor e modelo
    const grupos = new Map<
      string,
      {
        provedor: string;
        modelo: string;
        totalChamadas: number;
        somaTokens: number;
        somaCustoUsd: number;
        somaDuracaoMs: number;
      }
    >();

    for (const log of logs) {
      const prov = normalizarProvedorIa(log.provedor);
      const mod = normalizarModeloIa(log.modelo);
      const chave = `${prov}:${mod}`;

      const item = grupos.get(chave) || {
        provedor: prov,
        modelo: mod,
        totalChamadas: 0,
        somaTokens: 0,
        somaCustoUsd: 0,
        somaDuracaoMs: 0,
      };

      item.totalChamadas += 1;
      item.somaTokens += log.tokensTotal;
      if (log.custoUsd) {
        item.somaCustoUsd += Number(log.custoUsd);
      }
      if (log.duracaoMs) {
        item.somaDuracaoMs += log.duracaoMs;
      }

      grupos.set(chave, item);
    }

    let registrosProcessados = 0;

    // 3. Upsert de cada grupo consolidado
    for (const grupo of grupos.values()) {
      if (grupo.somaTokens <= 0) continue;

      // Custo ponderado por 1k tokens: (soma custo / soma tokens) * 1000
      const custoUsdPor1k = (grupo.somaCustoUsd / grupo.somaTokens) * 1000;
      // Segundos por 1k tokens: ((soma duracaoMs / 1000) / soma tokens) * 1000
      const segundosPor1k = (grupo.somaDuracaoMs / 1000 / grupo.somaTokens) * 1000;

      await prisma.iaMediasConsolidadas.upsert({
        where: {
          provedor_modelo: {
            provedor: grupo.provedor,
            modelo: grupo.modelo,
          },
        },
        create: {
          provedor: grupo.provedor,
          modelo: grupo.modelo,
          custoUsdPor1kTokens: custoUsdPor1k,
          segundosPor1kTokens: segundosPor1k,
          totalChamadas: grupo.totalChamadas,
          janelaDias,
          cotacaoUsdBrl: cotacaoReferencia,
        },
        update: {
          custoUsdPor1kTokens: custoUsdPor1k,
          segundosPor1kTokens: segundosPor1k,
          totalChamadas: grupo.totalChamadas,
          janelaDias,
          cotacaoUsdBrl: cotacaoReferencia,
          atualizadoEm: new Date(),
        },
      });

      registrosProcessados += 1;
    }

    return registrosProcessados;
  }

  /**
   * Obtém as médias consolidadas de IA para exibição no frontend.
   * Quando uma IA conhecida não tem registro ou tem 0 chamadas, preenche com estimativas de fallback.
   */
  public static async listarMediasConsolidadas(): Promise<IaMediaConsolidadaItem[]> {
    const cotacao = obterCotacaoUsdBrl();
    const janelaDias = Number(env.IA_MEDIA_JANELA_DIAS) || 90;

    const registrosBanco = await prisma.iaMediasConsolidadas.findMany({
      orderBy: [{ provedor: 'asc' }, { modelo: 'asc' }],
    });

    const mapaBanco = new Map<string, typeof registrosBanco[0]>();
    for (const r of registrosBanco) {
      mapaBanco.set(`${normalizarProvedorIa(r.provedor)}:${normalizarModeloIa(r.modelo)}`, r);
    }

    const resultado: IaMediaConsolidadaItem[] = [];

    // Adiciona os registros persistidos do banco
    for (const r of registrosBanco) {
      const cotacaoAplicada = Number(r.cotacaoUsdBrl) || cotacao;
      const custoUsd1k = Number(r.custoUsdPor1kTokens);
      const custoBrl1k = custoUsd1k * cotacaoAplicada;

      resultado.push({
        provedor: r.provedor,
        modelo: r.modelo,
        custoUsdPor1kTokens: custoUsd1k,
        custoBrlPor1kTokens: custoBrl1k,
        segundosPor1kTokens: Number(r.segundosPor1kTokens),
        totalChamadas: r.totalChamadas,
        janelaDias: r.janelaDias,
        cotacaoUsdBrl: cotacaoAplicada,
        isEstimativa: r.totalChamadas === 0,
        atualizadoEm: r.atualizadoEm.toISOString(),
      });
    }

    // Adiciona fallbacks para os modelos padrão conhecidos que ainda não têm registro
    for (const [provedor, modelos] of Object.entries(FALLBACKS_PADRAO)) {
      for (const modelo of Object.keys(modelos)) {
        const chave = `${normalizarProvedorIa(provedor)}:${normalizarModeloIa(modelo)}`;
        if (!mapaBanco.has(chave)) {
          const fallback = obterFallbackModel(provedor, modelo);
          const custoBrl1k = fallback.usdPor1k * cotacao;

          resultado.push({
            provedor,
            modelo,
            custoUsdPor1kTokens: fallback.usdPor1k,
            custoBrlPor1kTokens: custoBrl1k,
            segundosPor1kTokens: fallback.segPor1k,
            totalChamadas: 0,
            janelaDias,
            cotacaoUsdBrl: cotacao,
            isEstimativa: true,
            atualizadoEm: new Date().toISOString(),
          });
        }
      }
    }

    return resultado;
  }
}

/**
 * Worker para atualizar médias consolidadas em background após eventos de importação e login.
 */
export class IaMediasConsolidadasWorkerService {
  private static instance: IaMediasConsolidadasWorkerService;
  private isProcessing = false;
  private authListener = this.onLogin.bind(this);
  private importacaoListener = this.onLoteConcluido.bind(this);
  private arquivoListener = this.onArquivoConsolidado.bind(this);

  public static getInstance(): IaMediasConsolidadasWorkerService {
    if (!IaMediasConsolidadasWorkerService.instance) {
      IaMediasConsolidadasWorkerService.instance = new IaMediasConsolidadasWorkerService();
    }
    return IaMediasConsolidadasWorkerService.instance;
  }

  public setupEventListener(
    busAuth: AuthEventBus = authEventBus,
    busImportacao: ImportacaoEventBus = importacaoEventBus
  ): void {
    console.log('[evolvi-worker:ia-medias] Inicializando ouvinte de médias consolidadas de IA...');
    busAuth.onUsuarioAutenticado(this.authListener);
    busImportacao.onArquivoConsolidadoFinal(this.arquivoListener);
    busImportacao.onLoteConcluido(this.importacaoListener);
  }

  public removeEventListener(
    busAuth: AuthEventBus = authEventBus,
    busImportacao: ImportacaoEventBus = importacaoEventBus
  ): void {
    busAuth.removeListener(AuthEventBus.EVENT_USUARIO_AUTENTICADO, this.authListener);
    busImportacao.removeListener(ImportacaoEventBus.EVENT_ARQUIVO_CONSOLIDADO_FINAL, this.arquivoListener);
    busImportacao.removeListener(ImportacaoEventBus.EVENT_LOTE_CONCLUIDO, this.importacaoListener);
  }

  private onLogin(_event: UsuarioAutenticadoEvent): void {
    console.log(`[evolvi-worker:ia-medias] Usuário [${_event.usuarioId}] autenticado. Agendando consolidação de médias globais...`);
    this.agendarConsolidacao();
  }

  private onArquivoConsolidado(_event: any): void {
    console.log(`[evolvi-worker:ia-medias] Arquivo [${_event.nomeArquivo}] consolidado. Agendando consolidação de médias globais...`);
    this.agendarConsolidacao();
  }

  private onLoteConcluido(_event: ImportacaoLoteConcluidoEvent): void {
    console.log(`[evolvi-worker:ia-medias] Lote [${_event.loteId}] concluído. Agendando consolidação de médias globais...`);
    this.agendarConsolidacao();
  }

  public agendarConsolidacao(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;

    // Executa assincronamente sem bloquear o caller
    setImmediate(async () => {
      try {
        const inicio = Date.now();
        await IaMediasConsolidadasService.consolidarMediasGlobais();
        const duracao = Date.now() - inicio;
        console.log(`[evolvi-worker:ia-medias] Consolidação de médias concluída em ${duracao}ms.`);
      } catch (err) {
        console.error('⚠️ [evolvi-worker:ia-medias] Falha ao consolidar médias globais:', err);
      } finally {
        this.isProcessing = false;
      }
    });
  }
}

export const iaMediasConsolidadasWorkerService = IaMediasConsolidadasWorkerService.getInstance();
