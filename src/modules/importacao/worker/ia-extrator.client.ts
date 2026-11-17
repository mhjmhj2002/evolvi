import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { env } from '../../../config/env.js';
import {
  importacaoEventBus,
  ImportacaoLoteRecepcionadoEvent,
} from '../../../infrastructure/events/importacao-event-bus.js';
import { UniversalStatementParser } from '../../conector/parsers/universal-statement.parser.js';
import {
  ArquivoConsolidadoIa,
  LancamentoConsolidadoIa,
  arquivoConsolidadoIaSchema,
  lancamentoConsolidadoIaSchema,
} from './ia-extrator.schema.js';
import { descricaoIndicaPagamentoFatura, descricaoIndicaTransferenciaPropria } from '../../movimento/natureza-movimento.util.js';

import { PdfTextExtractor } from '../../conector/parsers/pdf-text-extractor.js';
import { dividirDocumentoEmPaginas, dividirPaginaEmChunks } from './ia-paginas.util.js';
import { obterInstrucoesSkillDocumento } from './ia-document-skills.js';
import { ClassificacaoDocumentoWorker, classificarDocumentoWorker } from './classificador-documento-worker.js';
import { CryptoService } from '../../../infrastructure/security/crypto.service.js';
import {
  TokensIa,
  UsoIaService,
  tokensDeUsageGemini,
  tokensDeUsageOpenAi,
} from '../../ia/uso-ia.service.js';
import {
  IA_CAPACIDADES_MEDIA,
  IaCapacidadeMedia,
  obterCapacidadeMedia,
} from '../../ia/capacidades-media.js';
import {
  MODELO_OPENROUTER_PADRAO,
  mensagemProvedorNaoSuportado,
  montarHeadersOpenRouter,
  montarUrlOpenRouter,
  normalizarModeloOpenRouter,
  obterConfigOpenRouter,
  provedorSuportadoNoFluxo,
} from '../../ia/openrouter.config.js';

const timeoutChamadaIaMs = Math.max(1000, Number(process.env.IMPORTACAO_IA_TIMEOUT_MS) || 60_000);
const timeoutArquivoIaMs = Math.max(timeoutChamadaIaMs, Number(process.env.IMPORTACAO_IA_TIMEOUT_ARQUIVO_MS) || 15 * 60_000);
const maxTentativasIa = Math.max(1, Math.min(5, Number(process.env.IMPORTACAO_IA_MAX_TENTATIVAS) || 3));
const concorrenciaIa = Math.max(1, Math.min(8, Number(process.env.IMPORTACAO_IA_CONCORRENCIA) || 2));
const concorrenciaChunksIa = concorrenciaIa;
const concorrenciaGlobalIa = concorrenciaIa;
const concorrenciaUsuarioIa = concorrenciaIa;
const deadlineArquivoIa = new AsyncLocalStorage<number>();

class SemaphoreIa {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async acquire(): Promise<() => void> {
    if (this.active < this.limit && this.queue.length === 0) {
      this.active += 1;
    } else {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const proximo = this.queue.shift();
      if (proximo) proximo();
      else this.active = Math.max(0, this.active - 1);
    };
  }
}

// Um único limite protege o provedor e permite paralelizar chunks do mesmo arquivo.
const semaforoGlobalIa = new SemaphoreIa(concorrenciaGlobalIa);
const semaforosUsuarioIa = new Map<string, SemaphoreIa>();
async function executarChamadaComLimite<T>(provedor: string, usuarioId: string | undefined, execucao: () => Promise<T>): Promise<T> {
  const porUsuarioKey = `${provedor}:${usuarioId || 'sem-usuario'}`;
  const porUsuario = semaforosUsuarioIa.get(porUsuarioKey) || new SemaphoreIa(concorrenciaUsuarioIa);
  semaforosUsuarioIa.set(porUsuarioKey, porUsuario);
  const liberarUsuario = await porUsuario.acquire();
  try {
    const liberarGlobal = await semaforoGlobalIa.acquire();
    try { return await execucao(); }
    finally { liberarGlobal(); }
  } finally {
    liberarUsuario();
  }
}

function validarTransacoesDoChunk(transacoes: LancamentoConsolidadoIa[]): LancamentoConsolidadoIa[] {
  return transacoes.map((transacao, indice) => {
    const validacao = lancamentoConsolidadoIaSchema.safeParse(transacao);
    if (!validacao.success) {
      throw new Error(`Lançamento ${indice + 1} retornado pela IA não passou na validação de schema: ${validacao.error.issues[0]?.message || 'estrutura inválida'}`);
    }
    return validacao.data;
  });
}

async function fetchIaResiliente(url: string, init: RequestInit): Promise<Response> {
  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= maxTentativasIa; tentativa += 1) {
    const restanteArquivo = deadlineArquivoIa.getStore();
    const prazo = restanteArquivo == null ? timeoutChamadaIaMs : Math.min(timeoutChamadaIaMs, restanteArquivo - Date.now());
    if (prazo <= 0) throw new Error(`Tempo limite total da extração excedido (${timeoutArquivoIaMs}ms).`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), prazo);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      let metadataErro: any;
      if (response.status === 402) {
        metadataErro = await response.clone().json().catch(() => null);
      }
      const retryBudgetEsgotado = metadataErro?.error?.metadata?.reason === 'in_flight_budget_exhausted';
      const retentavel = response.status === 429 || response.status >= 500 || retryBudgetEsgotado;
      if (!retentavel) return response;
      if (tentativa === maxTentativasIa) return response;
      const retryAfter = response.headers.get('retry-after')
        || metadataErro?.error?.metadata?.headers?.['Retry-After']
        || metadataErro?.error?.metadata?.headers?.['retry-after'];
      const segundosRetry = retryAfter ? Number(retryAfter) : NaN;
      const dataRetry = retryAfter ? Date.parse(retryAfter) : NaN;
      const atrasoRetryMs = Number.isFinite(segundosRetry) && segundosRetry > 0
        ? segundosRetry * 1000
        : (retryAfter && Number.isFinite(dataRetry) ? Math.max(0, dataRetry - Date.now()) : NaN);
      const esperaSugeridaMs = Number.isFinite(atrasoRetryMs)
        ? atrasoRetryMs
        : Math.min(500 * (2 ** (tentativa - 1)) + Math.random() * 300, 10_000);
      const deadline = deadlineArquivoIa.getStore();
      const janelaDisponivelMs = deadline == null
        ? timeoutArquivoIaMs
        : Math.max(0, deadline - Date.now());
      const esperaMs = Math.min(esperaSugeridaMs, janelaDisponivelMs);
      await response.body?.cancel().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, esperaMs));
    } catch (err) {
      ultimoErro = err;
      if (tentativa === maxTentativasIa) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(500 * (2 ** (tentativa - 1)) + Math.random() * 300, 10_000)));
    } finally {
      clearTimeout(timeout);
    }
  }
  const detalhe = ultimoErro instanceof Error && ultimoErro.name === 'AbortError'
    ? `Timeout da chamada após ${timeoutChamadaIaMs}ms`
    : (ultimoErro instanceof Error ? ultimoErro.message : String(ultimoErro));
  throw new Error(`Falha transitória na chamada de IA após ${maxTentativasIa} tentativas: ${detalhe}`);
}

// Reexportado para preservar a API pública histórica do módulo.
export type { IaCapacidadeMedia };
export { IA_CAPACIDADES_MEDIA };

export interface IIaExtratorClient {
  inventariarDocumento?(params: {
    nomeArquivo: string; mimeType?: string | null; conteudoBuffer: Buffer;
    usuarioId?: string; provedorIa?: string; modeloIa?: string;
    contexto: { dataReferencia: string; nomeTitular?: string | null };
    classificacao?: ClassificacaoDocumentoWorker;
  }): Promise<InventarioDocumentoIa>;
  extrairTransacoes(params: {
    nomeArquivo: string;
    mimeType?: string | null;
    conteudoBuffer: Buffer;
    conteudoTexto?: string;
    usuarioId?: string;
    provedorIa?: string;
    modeloIa?: string;
    /** Vínculo opcional do log de consumo de IA com o lote de importação (TASK-49). */
    loteId?: string;
    /** Vínculo opcional do log de consumo de IA com o arquivo importado (TASK-49). */
    arquivoId?: string;
    /**
     * TASK-50: handoff explícito do id da linha criada em `uso_ia_logs`, permitindo
     * correlacionar de forma determinística a tentativa do arquivo ao log de telemetria.
     */
    aoRegistrarUsoIa?: (usoIaLogId: string | null) => void;
    classificacao?: ClassificacaoDocumentoWorker;
    contexto: {
      contas: { id: string; nome: string; tipo: string }[];
      categorias: { id: string; nome: string }[];
      dataReferencia: string;
      nomeTitular?: string | null;
    };
  }): Promise<LancamentoConsolidadoIa[]>;
}

export interface InventarioDocumentoIa {
  paginasTotais?: number | null;
  paginaAtribuicaoDisponivel?: boolean;
  paginasSemTexto?: number[];
  paginasComMovimentos?: number[];
  registrosPorPagina: { pagina: number; quantidade: number }[];
  quantidadeEsperada?: number | null;
  dataInicial?: string | null; dataFinal?: string | null;
  somaAbsolutaEsperada?: number | null;
  tipoDocumento: 'EXTRATO_CONTA' | 'FATURA_CARTAO' | 'OUTRO';
  confianca: number; observacoes?: string | null;
}

export class GeminiIaExtratorClient implements IIaExtratorClient {
  private apiKey?: string;
  private model: string;
  private universalParser: UniversalStatementParser;

  public static isArquivoVisual(nomeArquivo: string, mimeType?: string | null): boolean {
    const ext = path.extname(nomeArquivo).toLowerCase();
    const visualExts = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tiff'];
    if (visualExts.includes(ext)) {
      return true;
    }
    if (mimeType && mimeType.startsWith('image/')) {
      return true;
    }
    return false;
  }

  public static suportaMidiaVisual(provedorIa?: string | null): boolean {
    const capacidade = obterCapacidadeMedia(provedorIa || 'GEMINI');
    return capacidade ? capacidade.suportaImagens : false;
  }

  constructor(apiKey?: string, model: string = 'gemini-3.8-flash') {
    this.apiKey = apiKey || env.GEMINI_API_KEY;
    this.model = model;
    this.universalParser = new UniversalStatementParser();
  }

  /**
   * Inventário estrutural universal. A contagem de páginas é obtida do próprio
   * PDF, sem heurística por instituição. O inventário anterior ficava vazio
   * porque a interface já declarava o método, mas a classe não o implementava.
   */
  public async inventariarDocumento(params: {
    nomeArquivo: string;
    mimeType?: string | null;
    conteudoBuffer: Buffer;
    usuarioId?: string;
    provedorIa?: string;
    modeloIa?: string;
    contexto: { dataReferencia: string; nomeTitular?: string | null };
    classificacao?: ClassificacaoDocumentoWorker;
  }): Promise<InventarioDocumentoIa> {
    const ehPdf = params.mimeType === 'application/pdf' || params.nomeArquivo.toLowerCase().endsWith('.pdf');
    if (!ehPdf) {
      return {
        paginasTotais: 1,
        paginaAtribuicaoDisponivel: true,
        paginasComMovimentos: [],
        registrosPorPagina: [],
        tipoDocumento: params.classificacao?.tipoDocumento ?? 'OUTRO',
        confianca: 0,
        observacoes: 'Formato sem paginação física; arquivo tratado como uma unidade de origem.',
      };
    }

    const pdf = params.conteudoBuffer.toString('latin1');
    const paginasTotais = Math.max(0, (pdf.match(/\/Type\s*\/Page(?:\s|\/|>)/g) || []).length);
    const textoPdf = PdfTextExtractor.extrairTexto(params.conteudoBuffer);
    const paginasTexto = dividirDocumentoEmPaginas(textoPdf, paginasTotais || null);
    const paginasTextuaisConferem = paginasTotais > 0 && paginasTexto.length === paginasTotais && paginasTexto.every((pagina) => pagina.pagina != null);
    const paginasSemTexto = paginasTexto.flatMap((pagina) => pagina.texto.trim() ? [] : pagina.pagina == null ? [] : [pagina.pagina]);
    return {
      paginasTotais: paginasTotais || null,
      paginaAtribuicaoDisponivel: paginasTextuaisConferem,
      paginasSemTexto,
      paginasComMovimentos: [],
      registrosPorPagina: [],
      tipoDocumento: params.classificacao?.tipoDocumento ?? 'OUTRO',
      confianca: paginasTotais > 0 ? 1 : 0,
      observacoes: paginasTotais > 0
        ? paginasTextuaisConferem
          ? 'Total de páginas obtido da estrutura do PDF; limites de página disponíveis no texto extraído.'
          : 'Total de páginas obtido da estrutura do PDF, mas o texto extraído não preservou todos os limites de página.'
        : 'Não foi possível identificar páginas na estrutura do PDF.',
    };
  }

  public async extrairTransacoes(params: {
    nomeArquivo: string;
    mimeType?: string | null;
    conteudoBuffer: Buffer;
    conteudoTexto?: string;
    usuarioId?: string;
    provedorIa?: string;
    modeloIa?: string;
    loteId?: string;
    arquivoId?: string;
    /** TASK-50: handoff do id do log criado em `uso_ia_logs`. */
    aoRegistrarUsoIa?: (usoIaLogId: string | null) => void;
    classificacao?: ClassificacaoDocumentoWorker;
    contexto: {
      contas: { id: string; nome: string; tipo: string; numeroConta?: string | null; agencia?: string | null }[];
      categorias: { id: string; nome: string }[];
      dataReferencia: string;
      nomeTitular?: string | null;
    };
  }): Promise<LancamentoConsolidadoIa[]> {
    const { nomeArquivo, mimeType, conteudoBuffer, contexto } = params;

    // Se o arquivo for PDF e não possuir conteudoTexto fornecido, extraímos previamente via PdfTextExtractor
    let textoProcessado = params.conteudoTexto;
    const isPdf =
      (mimeType && mimeType.includes('pdf')) ||
      nomeArquivo.toLowerCase().endsWith('.pdf') ||
      conteudoBuffer.subarray(0, 5).toString('latin1') === '%PDF-';

    if (isPdf && !textoProcessado) {
      textoProcessado = PdfTextExtractor.extrairTexto(conteudoBuffer);
    }
    const extDocumento = path.extname(nomeArquivo).toLowerCase();
    const classificacao = params.classificacao || (['.pdf', '.csv'].includes(extDocumento)
      ? classificarDocumentoWorker({ nomeArquivo, conteudoBuffer })
      : {
          instituicao: null,
          chaveInstituicaoSkill: null,
          tipoDocumento: 'OUTRO' as const,
          origemInstituicao: 'NAO_IDENTIFICADA' as const,
          origemTipo: 'NAO_IDENTIFICADO' as const,
          evidencia: [],
        });
    const instrucoesSkillDocumento = obterInstrucoesSkillDocumento({
      tipoDocumento: classificacao.tipoDocumento,
      chaveInstituicaoSkill: classificacao.chaveInstituicaoSkill,
    });
    const contextoComSkill = { ...contexto, classificacaoDocumento: classificacao, instrucoesSkillDocumento };

    // 1. Se for formato estritamente estruturado padrão (OFX, CSV com cabeçalho bancário ou JSON estruturado),
    // é seguro extrair diretamente via parser determinístico
    const ext = path.extname(nomeArquivo).toLowerCase();
    const isEstruturadoPadrao =
      ext === '.ofx' ||
      ext === '.csv' ||
      ext === '.json' ||
      conteudoBuffer.includes('<OFX>') ||
      conteudoBuffer.includes('<BANKTRANLIST>');

    if (isEstruturadoPadrao) {
      const transacoesEstruturadas = this.extrairLocalDeterministic({
        ...params,
        conteudoTexto: textoProcessado,
      });
      if (transacoesEstruturadas.length > 0) {
        return transacoesEstruturadas.map((transacao) => ({ ...transacao, paginaOrigem: 1 }));
      }

      // Se for CSV estruturado válido porém sem lançamentos (ex: somente cabeçalho), retorna array vazio
      if (ext === '.csv' || ext === '.json' || ext === '.ofx') {
        const texto = textoProcessado || conteudoBuffer.toString('utf-8');
        const linhas = texto.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (linhas.length <= 1) {
          return [];
        }
      }
    }

    // 3. Rigor Exclusivo da IA para documentos complexos / não-estruturados (PDFs, imagens, textos livres):
    // Se o usuário especificou um provedor ou se precisa de chave do usuário no banco:
    let apiKeyEfetiva: string | undefined = undefined;
    let modeloEfetivo = params.modeloIa || this.model;
    let provedorEfetivo = params.provedorIa;

    if (params.usuarioId) {
      const configUsuario = params.provedorIa
        ? await prisma.configuracaoIaUsuario.findUnique({
            where: {
              usuarioId_provedor: {
                usuarioId: params.usuarioId,
                provedor: params.provedorIa,
              },
            },
          })
        : await prisma.configuracaoIaUsuario.findFirst({
            where: { usuarioId: params.usuarioId },
            orderBy: { atualizadoEm: 'desc' },
          });

      if (configUsuario) {
        try {
          apiKeyEfetiva = CryptoService.decrypt({
            ciphertext: configUsuario.apiKeyCifrada,
            iv: configUsuario.ivHex,
            tag: configUsuario.tagHex,
          });
          modeloEfetivo = params.modeloIa || configUsuario.modelo || modeloEfetivo;
          provedorEfetivo = configUsuario.provedor;
        } catch (err) {
          console.error('[GeminiIaExtratorClient] Erro ao decifrar chave do usuário:', err);
        }
      }
    }

    // Se ainda não tiver provedor definido pelo usuário ou banco, o padrão do sistema é GEMINI
    if (!provedorEfetivo) {
      provedorEfetivo = 'GEMINI';
    }

    provedorEfetivo = provedorEfetivo.trim().toUpperCase();

    // Provedores sem implementação neste fluxo (ANTHROPIC) NÃO devem cair
    // silenciosamente no Gemini — erro explícito e acionável.
    if (!provedorSuportadoNoFluxo(provedorEfetivo)) {
      throw new Error(mensagemProvedorNaoSuportado(provedorEfetivo));
    }

    // Auto-sanitização: Se o modelo solicitado ou recuperado do perfil for o descontinuado gemini-2.5-flash, atualiza para gemini-3.8-flash
    if (provedorEfetivo === 'GEMINI' && modeloEfetivo === 'gemini-2.5-flash') {
      modeloEfetivo = 'gemini-3.8-flash';
    }

    // Modelo do OpenRouter normalizado (exige o formato `vendor/model`).
    if (provedorEfetivo === 'OPENROUTER') {
      modeloEfetivo = normalizarModeloOpenRouter(modeloEfetivo);
    }

    // NUNCA fazer fallback para chave de GEMINI se o provedor for DEEPSEEK ou outro provedor selecionado!
    if (!apiKeyEfetiva && provedorEfetivo === 'GEMINI' && !params.provedorIa) {
      apiKeyEfetiva = this.apiKey;
    } else if (!apiKeyEfetiva && params.provedorIa === 'GEMINI') {
      apiKeyEfetiva = this.apiKey;
    } else if (!apiKeyEfetiva && provedorEfetivo === 'OPENROUTER') {
      // Paridade com GEMINI_API_KEY: chave de servidor (OPENROUTER_API_KEY) como fallback.
      apiKeyEfetiva = obterConfigOpenRouter().apiKeyServidor || undefined;
    }

    if (!apiKeyEfetiva) {
      throw new Error(
        `A IA não conseguiu processar este documento. Verifique se a chave de IA para o provedor ${provedorEfetivo} está devidamente cadastrada e ativa no seu perfil.`
      );
    }

    // 4.1. Validação de Compatibilidade de Mídia:
    // Se for arquivo visual (imagem) e o modelo não for multimodal (ex: DeepSeek), interrompe sem enviar bytes brutos
    if (GeminiIaExtratorClient.isArquivoVisual(nomeArquivo, mimeType) && !GeminiIaExtratorClient.suportaMidiaVisual(provedorEfetivo)) {
      throw new Error(
        `Arquivo não processado: O modelo selecionado (${provedorEfetivo}) não oferece suporte a imagens (.jpg/.png). Reprocesse individualmente selecionando o Google Gemini.`
      );
    }

    // Se temos apiKey, tentamos chamada de IA para o provedor selecionado.
    // TASK-49: toda chamada de IA gera EXATAMENTE 1 registro em `uso_ia_logs`
    // (sucesso ou falha). Qualquer erro de telemetria é engolido internamente
    // pelo UsoIaService, nunca interrompendo a importação.
    // Divide documentos textuais longos em blocos universais antes da chamada.
    // O limite é por tamanho de texto, nunca por banco/instituição/layout.
    // Isso evita que a resposta JSON seja truncada no limite de tokens do provedor.
    const textoParaChunks = textoProcessado || '';
    // 4.000 caracteres mantém margem para documentos com muitas colunas e
    // evita que a lista de lançamentos consuma todo o limite de saída JSON.
    // Blocos maiores reduzem requisições; lotes paralelos controlados reduzem a espera.
    const tamanhoChunk = 4000;
    const pdfTotalPaginas = isPdf
      ? Math.max(0, (conteudoBuffer.toString('latin1').match(/\/Type\s*\/Page(?:\s|\/|>)/g) || []).length) || null
      : 1;
    const paginasDocumento = dividirDocumentoEmPaginas(textoParaChunks, pdfTotalPaginas);
    const chunks = dividirPaginaEmChunks(paginasDocumento, tamanhoChunk);
    if (chunks.length === 0) chunks.push({ pagina: pdfTotalPaginas === 1 ? 1 : null, texto: '' });
    const textoEntradaDoChunk = (indice: number): string => {
      const chunk = chunks[indice];
      if (chunk.pagina == null) return chunk.texto;

      const chunkAnterior = chunks[indice - 1];
      let contextoMesmoArquivo: string | undefined;
      if (chunkAnterior && chunkAnterior.pagina === chunk.pagina) {
        contextoMesmoArquivo = chunkAnterior.texto.slice(-1200);
      } else if (chunkAnterior && chunkAnterior.pagina === chunk.pagina - 1) {
        contextoMesmoArquivo = chunkAnterior.texto.slice(-1200);
      } else {
        contextoMesmoArquivo = paginasDocumento
          .find((pagina) => pagina.pagina === chunk.pagina! - 1)?.texto.slice(-1200);
      }

      if (!contextoMesmoArquivo?.trim()) return chunk.texto;
      return `CONTEXTO DO TRECHO/PÁGINA ANTERIOR (somente para interpretar continuidade e datas; não extraia lançamentos daqui):\n"""\n${contextoMesmoArquivo}\n"""\n\nTRECHO ATUAL (extraia lançamentos somente daqui):\n"""\n${chunk.texto}\n"""`;
    };
    const chamada: (texto?: string) => Promise<{ transacoes: LancamentoConsolidadoIa[]; tokens: TokensIa }> =
      provedorEfetivo === 'DEEPSEEK' || provedorEfetivo === 'OPENAI'
        ? (texto = textoProcessado) =>
            this.chamarDeepSeekApi(
              nomeArquivo,
              conteudoBuffer,
              contextoComSkill,
              texto,
              apiKeyEfetiva,
              modeloEfetivo,
              provedorEfetivo
            )
        : provedorEfetivo === 'OPENROUTER'
          ? (texto = textoProcessado) =>
              this.chamarOpenRouterApi(
                nomeArquivo,
                mimeType,
                conteudoBuffer,
                contextoComSkill,
                texto,
                apiKeyEfetiva,
                modeloEfetivo
              )
          : (texto = textoProcessado) =>
              this.chamarGeminiApi(
                nomeArquivo,
                mimeType,
                conteudoBuffer,
                contextoComSkill,
                texto,
                apiKeyEfetiva,
                modeloEfetivo
              );

    try {
      const resultado = await UsoIaService.registrarChamada({
        usuarioId: params.usuarioId,
        funcionalidade: 'EXTRACAO_EXTRATO',
        provedor: provedorEfetivo,
        modelo: modeloEfetivo,
        loteId: params.loteId,
        arquivoId: params.arquivoId,
        execucao: async () => {
          const hashContexto = createHash('sha256').update(JSON.stringify(contextoComSkill)).digest('hex');
          const checkpoints = params.arquivoId && params.usuarioId
            ? await prisma.$queryRaw<Array<{ indice: number; hashConteudo: string; hashContexto: string; provedor: string; modelo: string; versaoPrompt: string; versaoSchema: string; resultado: unknown }>>`
                SELECT indice, hash_conteudo AS "hashConteudo", hash_contexto AS "hashContexto", provedor, modelo,
                  versao_prompt AS "versaoPrompt", versao_schema AS "versaoSchema", resultado
                FROM checkpoints_chunks_ia WHERE arquivo_id = ${params.arquivoId}::uuid AND usuario_id = ${params.usuarioId}::uuid`
            : [];
          const inicioArquivo = Date.now();
          const deadlineMs = inicioArquivo + timeoutArquivoIaMs;
          const extrairChunk = async (indiceChunk: number): Promise<{ transacoes: LancamentoConsolidadoIa[]; tokens: TokensIa }> => {
            const chunk = chunks[indiceChunk];
            if (Date.now() - inicioArquivo >= timeoutArquivoIaMs) throw new Error(`Tempo limite total da extração excedido (${timeoutArquivoIaMs}ms). Os chunks concluídos foram preservados.`);
            const textoEntrada = textoEntradaDoChunk(indiceChunk);
            const hashChunk = createHash('sha256').update(`${chunk.pagina ?? 'sem-pagina'}\n${textoEntrada}`).digest('hex');
            const checkpoint = checkpoints.find((c) => c.indice === indiceChunk && c.hashConteudo === hashChunk &&
              c.hashContexto === hashContexto && c.provedor === provedorEfetivo && c.modelo === modeloEfetivo &&
              c.versaoPrompt === 'extracao-v4' && c.versaoSchema === 'lancamento-v2');
            const resultadoChunk = checkpoint
              ? { transacoes: checkpoint.resultado as unknown as LancamentoConsolidadoIa[], tokens: { tokensPrompt: 0, tokensResposta: 0, tokensTotal: 0 } }
              : await executarChamadaComLimite(provedorEfetivo, params.usuarioId, () => deadlineArquivoIa.run(deadlineMs, () => chamada(textoEntrada)));
            const transacoesComPagina = resultadoChunk.transacoes.map((transacao) => ({ ...transacao, paginaOrigem: chunk.pagina }));
            if (!checkpoint && params.arquivoId && params.usuarioId) {
              await prisma.$executeRaw`
                INSERT INTO checkpoints_chunks_ia (usuario_id, arquivo_id, indice, hash_conteudo, hash_contexto,
                  provedor, modelo, versao_prompt, versao_schema, resultado)
                VALUES (${params.usuarioId}::uuid, ${params.arquivoId}::uuid, ${indiceChunk}, ${hashChunk}, ${hashContexto},
                  ${provedorEfetivo}, ${modeloEfetivo}, 'extracao-v4', 'lancamento-v2', ${JSON.stringify(transacoesComPagina)}::jsonb)
                ON CONFLICT (arquivo_id, indice) DO UPDATE SET usuario_id = EXCLUDED.usuario_id,
                  hash_conteudo = EXCLUDED.hash_conteudo, hash_contexto = EXCLUDED.hash_contexto,
                  provedor = EXCLUDED.provedor, modelo = EXCLUDED.modelo, versao_prompt = EXCLUDED.versao_prompt,
                  versao_schema = EXCLUDED.versao_schema, resultado = EXCLUDED.resultado, atualizado_em = NOW()`;
            }
            return { ...resultadoChunk, transacoes: transacoesComPagina };
          };
          const resultadosChunks = new Array<{ transacoes: LancamentoConsolidadoIa[]; tokens: TokensIa }>(chunks.length);
          let proximoChunk = 0;
          const trabalhadores = Array.from({ length: Math.min(concorrenciaChunksIa, chunks.length) }, async () => {
            while (true) {
              const indice = proximoChunk++;
              if (indice >= chunks.length) return;
              resultadosChunks[indice] = await extrairChunk(indice);
            }
          });
          await Promise.all(trabalhadores);

          const resultados = [] as LancamentoConsolidadoIa[];
          let tokensPrompt = 0;
          let tokensResposta = 0;
          let tokensTotal = 0;
          for (const [indiceChunk, resultadoChunk] of resultadosChunks.entries()) {
            const chunk = chunks[indiceChunk];
            tokensPrompt += resultadoChunk.tokens.tokensPrompt;
            tokensResposta += resultadoChunk.tokens.tokensResposta;
            tokensTotal += resultadoChunk.tokens.tokensTotal;
            const datas = resultadoChunk.transacoes.map((transacao) => transacao.dataMovimento).sort();
            for (const transacao of resultadoChunk.transacoes) resultados.push(transacao);
            console.info('[evolvi-ia:chunk]', JSON.stringify({
              arquivoId: params.arquivoId,
              provedor: provedorEfetivo,
              modelo: modeloEfetivo,
              chunkIndex: indiceChunk + 1,
              totalChunks: chunks.length,
              caracteresEntrada: textoEntradaDoChunk(indiceChunk).length,
              transacoesRetornadas: resultadoChunk.transacoes.length,
              transacoesNovas: resultadoChunk.transacoes.length,
              duplicadasNoChunk: 0,
              tokensPrompt: resultadoChunk.tokens.tokensPrompt,
              tokensResposta: resultadoChunk.tokens.tokensResposta,
              primeiraData: datas[0] || null,
              ultimaData: datas.at(-1) || null,
            }));
          }

          return {
            transacoes: resultados,
            tokens: { tokensPrompt, tokensResposta, tokensTotal },
          };
        },
        extrairTokens: (r) => r.tokens,
        // TASK-50: handoff explícito do id do log para a tentativa do arquivo.
        aoRegistrar: (logId) => params.aoRegistrarUsoIa?.(logId),
      });

      return resultado.transacoes;
    } catch (err: unknown) {
      const detalhe = err instanceof Error ? err.message : String(err);
      console.error(
        `[GeminiIaExtratorClient] Falha na extração por IA (${provedorEfetivo}) para "${nomeArquivo}": ${detalhe}`
      );
      // NUNCA fazer fallback heurístico cego para documentos complexos/não estruturados.
      throw new Error(`A IA (${provedorEfetivo}) não conseguiu processar este documento. Motivo: ${detalhe}`);
    }
  }

  private async chamarDeepSeekApi(
    nomeArquivo: string,
    conteudoBuffer: Buffer,
    contexto: {
      contas: { id: string; nome: string; tipo: string; numeroConta?: string | null; agencia?: string | null }[];
      categorias: { id: string; nome: string }[];
      dataReferencia: string;
      nomeTitular?: string | null;
      classificacaoDocumento?: ClassificacaoDocumentoWorker;
      instrucoesSkillDocumento?: string;
    },
    textoProcessado?: string,
    apiKeyOverride?: string,
    modelOverride?: string,
    provedor: 'DEEPSEEK' | 'OPENAI' = 'DEEPSEEK'
  ): Promise<{ transacoes: LancamentoConsolidadoIa[]; tokens: TokensIa }> {
    const key = apiKeyOverride || this.apiKey;
    const mod = modelOverride || (provedor === 'OPENAI' ? 'gpt-4o-mini' : 'deepseek-chat');
    const url = provedor === 'OPENAI'
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://api.deepseek.com/chat/completions';

    const texto = textoProcessado || conteudoBuffer.toString('utf-8');
    if (!texto || texto.trim().length === 0) {
      throw new Error(`Não foi possível extrair texto legível deste documento para enviar ao ${provedor}.`);
    }

    const titularInfo = contexto.nomeTitular ? `Nome do titular da conta: "${contexto.nomeTitular}".` : '';

    const contasFormatadas = contexto.contas
      .map((c) => {
        let det = `- "${c.nome}" (Tipo: ${c.tipo}`;
        if (c.agencia) det += `, Agência: ${c.agencia}`;
        if (c.numeroConta) det += `, Conta: ${c.numeroConta}`;
        det += ')';
        return det;
      })
      .join('\n') || '(Nenhuma cadastrada)';

    const promptSistema = `Você é o extrator inteligente e especialista financeiro do sistema Evolvi.
Sua missão é extrair rigorosamente TODAS as transações financeiras (despesas, receitas, faturas, pagamentos, transferências) contidas no documento ou extrato anexo.
${contexto.instrucoesSkillDocumento || ''}
Classificação feita previamente pelo worker (fonte de verdade; não reidentifique nem altere): instituição ${contexto.classificacaoDocumento?.instituicao || 'não identificada'}; tipo ${contexto.classificacaoDocumento?.tipoDocumento || 'não identificado'}. Use a instituição somente como contexto e classifique cada lançamento pela seção/conta indicada no documento.
${titularInfo}

DIRETRIZES FUNDAMENTAIS:
1. Extração Exaustiva: Não omita nenhuma linha ou lançamento financeiro real. Cada compra, débito, crédito ou movimentação deve gerar um item no array "transacoes".
2. Anti-dupla contagem e Mesma Titularidade:
   - Se for pagamento de fatura de cartão de crédito em extrato bancário de conta corrente (ex: "PAGTO FATURA", "PGTO CARTAO", "PAGAMENTO DE FATURA"): defina "natureza" = "TRANSFERENCIA_PROPRIA" e "isPagamentoFatura" = true.
   - LINHAS INFORMATIVAS DE PAGAMENTO EM FATURA DE CARTÃO (BUG-13): Em faturas de cartão de crédito, linhas como "PAGAMENTO RECEBIDO", "CRÉDITO DE PAGAMENTO DE FATURA", "PAGAMENTO EFETUADO" são compensações informativas da fatura e NÃO geram movimentação de caixa (pois o débito ocorre na conta corrente). Defina "natureza" = "TRANSFERENCIA_PROPRIA", "isPagamentoFatura" = true e "observacao" = "Informativo de quitação em fatura de cartão".
   - Créditos de salário ou proventos de empresa (ex: "TED CONTA SALARIO", "CRED SALARIO", "PLR", "REMUNERACAO", "FOLHA DE PAGAMENTO", "BONUS SALARIAL") são SEMPRE RECEITA operacional, mesmo quando o nome do titular constar na linha como favorecido/remetente da conta salário.
   - Só classifique PIX/TED como "TRANSFERENCIA_PROPRIA" quando o documento declarar explicitamente que as contas têm a mesma titularidade ou que a conta de destino também pertence ao titular. Não infira titularidade por nome completo, sobrenome, nome parcial, favorecido ou alias de conta. Se for pagamento a outra pessoa ou não houver prova de titularidade comum, mantenha a natureza de despesa/receita indicada pelo sentido da movimentação. Resgates de aplicação/investimento só são transferência própria se o documento identificar que retornam a uma aplicação do mesmo titular.
   - Para aplicações financeiras, aportes, investimentos e compras de ativos (ex: "APLICAÇÃO", "APLICACAO", "CDB", "RDB", "LCI", "LCA", "TESOURO DIRETO", "DEPOSITO POUPANCA", "COMPRA ACOES", "INVESTIMENTO"): defina categoricamente "natureza" = "APORTE_PATRIMONIAL" (NUNCA classifique como DESPESA!).
   - Para compras ou despesas normais: "natureza" = "DESPESA".
   - Para salários, PLR, rendimentos de aplicações, transferências recebidas de terceiros: "natureza" = "RECEITA".
3. Formato da Data e Regra de Ouro para Cartões:
   - Formato estrito: "YYYY-MM-DD". Se a linha trouxer apenas DD/MM, use o ano do período do extrato ou das datas de movimentação próximas na mesma tabela; use o ano de referência ("${contexto.dataReferencia.substring(0, 4)}") somente quando o documento não der contexto melhor.
   - Identifique a data da própria movimentação. Não use datas de emissão, geração, impressão, exportação, cabeçalho, rodapé ou identificação do modelo do documento como data de lançamento. Não escolha o ano apenas por ser o mais frequente no arquivo inteiro: considere a frequência somente entre datas que pertencem às linhas de movimentação e confira o período do documento.
   - Quando uma tabela mostrar a data uma vez e as linhas seguintes forem continuação do mesmo grupo, aplique essa data às linhas sem data até aparecer outra data explícita. Não transforme uma data omitida em dia 1. Não confunda períodos citados na descrição (por exemplo, período de cálculo de tarifa/encargo) com a data do lançamento.
   - Se o texto incluir contexto de uma página ou trecho anterior, use-o apenas para interpretar a data e a continuidade da tabela; extraia transações somente do trecho atual.
   - REGRA PARA FATURAS DE CARTÃO DE CRÉDITO:
     * Para COMPRAS À VISTA (sem parcelas) ocorridas no ciclo recente da fatura: a "dataMovimento" DEVE ser a data exata da transação (compra).
     * Para COMPRAS PARCELADAS (ex: "Parcela 2/10", "01/03", "5 de 6"): a exigibilidade financeira e o débito desta parcela ocorrem na fatura atual. Portanto, a "dataMovimento" deve ser atribuída ao mês e ano da fatura (usando o dia de fechamento/vencimento ou dataReferencia "${contexto.dataReferencia}"), preservando a data da compra original no texto da descrição/observação. NUNCA aloque uma parcela cobrada na fatura atual para um mês ou ano anterior!
4. Formato de Valor: número decimal estritamente positivo (ponto como separador, ex: 125.50). Desconsidere ou não inclua linhas informativas com valor R$ 0,00 ou cupons de 100% de desconto.
5. Parcelamento: Se houver indicação de parcela (ex: "01/03", "3/10", "parcela 2 de 5"), preencha "parcelaAtual" e "totalParcelas".
6. Contas disponíveis do usuário:
${contasFormatadas}
Use somente os dados da conta/cartão explicitamente presentes no documento e as contas disponíveis do usuário; não infira conta, produto ou layout a partir da marca da instituição.
Classifique a origem pelo tipo de seção/conta em que cada movimentação está listada: CONTA_CORRENTE, POUPANCA, INVESTIMENTO ou CARTAO_CREDITO. Uma movimentação de aplicação CDB listada na seção de conta corrente continua sendo da CONTA_CORRENTE; use INVESTIMENTO para movimentações listadas na conta/seção de investimento. Inclua movimentações efetivas de poupança, inclusive rendimentos creditados. Não converta saldos anterior/atual, resumos ou subtotais em lançamentos. Se houver contas do usuário compatíveis, use o nome correspondente em "contaSugerida".
Identificação precisa da conta/cartão (BUG-16):
- Se for extrato de conta corrente e houver número da conta/agência legível no cabeçalho ou metadados, extraia apenas os dígitos em "numeroConta" (ex: "010830489" ou "24220973" ou "123456").
- Se for fatura de cartão de crédito e houver indicação do final do cartão/dígitos (ex: "Final 2458", "Cartão 7936"), extraia os últimos dígitos (normalmente 4 dígitos) em "digitosCartao".
7. Categorias disponíveis (POF):
${contexto.categorias.map((c) => `- "${c.nome}"`).join('\n') || '(Nenhuma cadastrada)'}
Preencha "categoriaSugerida" com a categoria mais aderente.
8. Código Identificador da Transação (idOrigem):
- Se o extrato/fatura apresentar código de transação, identificador único, "Nº Documento", "Documento", "NSU", "ID Transação" ou código de autenticação correspondente ao lançamento, extraia esse valor no campo "idOrigem". Isso é crucial para diferenciar e rastrear lançamentos únicos! Se não houver, preencha null.

FORMATO DE RESPOSTA OBRIGATÓRIO (JSON puro):
{
  "transacoes": [
    {
      "dataMovimento": "YYYY-MM-DD",
      "descricao": "string concisa",
      "valor": 99.90,
      "natureza": "DESPESA" | "RECEITA" | "TRANSFERENCIA_PROPRIA" | "APORTE_PATRIMONIAL",
      "contaSugerida": "string ou null",
      "tipoConta": "CONTA_CORRENTE" | "POUPANCA" | "CARTAO_CREDITO" | "INVESTIMENTO" | "OUTRO" | null,
      "numeroConta": "string ou null",
      "digitosCartao": "string ou null",
      "categoriaSugerida": "string ou null",
      "parcelaAtual": number ou null,
      "totalParcelas": number ou null,
      "idOrigem": "string ou null",
      "isPagamentoFatura": boolean,
      "observacao": "string ou null",
      "confianca": number
    }
  ]
}`;

    const body = {
      model: mod,
      messages: [
        { role: 'system', content: promptSistema },
        {
          role: 'user',
          content: `Documento financeiro a analisar:\n"""\n${texto}\n"""`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 8192,
    };

    const res = await fetchIaResiliente(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erro na API ${provedor} (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as any;
    const rawText = data.choices?.[0]?.message?.content;
    if (!rawText) {
      throw new Error(`A resposta do ${provedor} não continha texto de saída.`);
    }
    // TASK-49: contagem real de tokens devolvida pelo provedor (usage)
    const tokens = tokensDeUsageOpenAi(data.usage);

    let parsedJson: any;
    try {
      parsedJson = JSON.parse(rawText);
    } catch {
      // Nunca recuperar objetos de uma resposta truncada: isso transforma perda
      // silenciosa em sucesso parcial. O chunk inteiro deve ser reprocessado.
      throw new Error(`A resposta do ${provedor} gerou JSON incompleto ou inválido: ${rawText.slice(-100)}`);
    }
    const lista = Array.isArray(parsedJson) ? parsedJson : parsedJson.transacoes || [];

    const transacoes = lista
      .map((t: any) => ({
        dataMovimento: t.dataMovimento || contexto.dataReferencia,
        descricao: String(t.descricao || 'Lançamento extraído'),
        valor: Math.abs(Number(t.valor) || 0),
        natureza: t.natureza || 'DESPESA',
        contaSugerida: t.contaSugerida || null,
        tipoConta: t.tipoConta || null,
        categoriaSugerida: t.categoriaSugerida || null,
        parcelaAtual: t.parcelaAtual ? Number(t.parcelaAtual) : null,
        totalParcelas: t.totalParcelas ? Number(t.totalParcelas) : null,
        idOrigem: t.idOrigem ? String(t.idOrigem) : null,
        isPagamentoFatura: Boolean(t.isPagamentoFatura),
        observacao: t.observacao || null,
        confianca: Number(t.confianca ?? 0.95),
      }))
      .filter((t: LancamentoConsolidadoIa) => t.valor > 0);

    return { transacoes: validarTransacoesDoChunk(transacoes), tokens };
  }

  private async chamarOpenRouterApi(
    nomeArquivo: string,
    mimeType: string | null | undefined,
    conteudoBuffer: Buffer,
    contexto: {
      contas: { id: string; nome: string; tipo: string; numeroConta?: string | null; agencia?: string | null }[];
      categorias: { id: string; nome: string }[];
      dataReferencia: string;
      nomeTitular?: string | null;
      classificacaoDocumento?: ClassificacaoDocumentoWorker;
      instrucoesSkillDocumento?: string;
    },
    textoProcessado?: string,
    apiKeyOverride?: string,
    modelOverride?: string
  ): Promise<{ transacoes: LancamentoConsolidadoIa[]; tokens: TokensIa }> {
    // API compatível com OpenAI (chat completions). URL base e headers de
    // atribuição vêm de `openrouter.config.ts` (OPENROUTER_BASE_URL/HTTP_REFERER/X_TITLE).
    const key = apiKeyOverride || this.apiKey;
    const mod = normalizarModeloOpenRouter(modelOverride || MODELO_OPENROUTER_PADRAO);
    const url = montarUrlOpenRouter('/chat/completions');

    const effectiveMime = mimeType || this.inferirMimeType(nomeArquivo);
    const capacidade = obterCapacidadeMedia('OPENROUTER');

    const isImagem = GeminiIaExtratorClient.isArquivoVisual(nomeArquivo, mimeType);
    const isPdf =
      effectiveMime.includes('pdf') ||
      nomeArquivo.toLowerCase().endsWith('.pdf') ||
      conteudoBuffer.subarray(0, 5).toString('latin1') === '%PDF-';

    // Texto legível disponível (extraído previamente ou conteúdo textual de fato).
    const textoLegivel = textoProcessado && textoProcessado.trim().length > 0 ? textoProcessado : null;

    // PDF sem texto extraído ⇒ binário NÃO pode ser enviado como texto UTF-8.
    if (isPdf && !textoLegivel && !capacidade?.suportaPdfsNaoEstruturados) {
      throw new Error(
        'Este PDF não possui texto legível e o provedor OPENROUTER está configurado sem suporte a PDFs não estruturados. Reprocesse selecionando o Google Gemini.'
      );
    }

    if (!isImagem && !isPdf && !textoLegivel) {
      const bruto = conteudoBuffer.toString('utf-8').trim();
      if (bruto.length === 0 || bruto.includes('\uFFFD')) {
        throw new Error('Não foi possível extrair texto legível deste documento para enviar ao OpenRouter.');
      }
    }

    // Conteúdo binário (imagem/PDF não estruturado) nunca é enviado como string UTF-8.
    const conteudoBinario = isImagem || (isPdf && !textoLegivel);
    const texto = textoLegivel || (conteudoBinario ? null : conteudoBuffer.toString('utf-8'));

    const titularInfo = contexto.nomeTitular ? `Nome do titular da conta: "${contexto.nomeTitular}".` : '';

    const contasFormatadas = contexto.contas
      .map((c) => {
        let det = `- "${c.nome}" (Tipo: ${c.tipo}`;
        if (c.agencia) det += `, Agência: ${c.agencia}`;
        if (c.numeroConta) det += `, Conta: ${c.numeroConta}`;
        det += ')';
        return det;
      })
      .join('\n') || '(Nenhuma cadastrada)';

    const promptSistema = `Você é o extrator inteligente e especialista financeiro do sistema Evolvi.
Sua missão é extrair rigorosamente TODAS as transações financeiras (despesas, receitas, faturas, pagamentos, transferências) contidas no documento ou extrato anexo.
${contexto.instrucoesSkillDocumento || ''}
Classificação feita previamente pelo worker (fonte de verdade; não reidentifique nem altere): instituição ${contexto.classificacaoDocumento?.instituicao || 'não identificada'}; tipo ${contexto.classificacaoDocumento?.tipoDocumento || 'não identificado'}. Use a instituição somente como contexto e classifique cada lançamento pela seção/conta indicada no documento.
${titularInfo}

DIRETRIZES FUNDAMENTAIS:
1. Extração Exaustiva: Não omita nenhuma linha ou lançamento financeiro real. Cada compra, débito, crédito ou movimentação deve gerar um item no array "transacoes".
2. Anti-dupla contagem e Mesma Titularidade:
   - Se for pagamento de fatura de cartão de crédito em extrato bancário de conta corrente (ex: "PAGTO FATURA", "PGTO CARTAO", "PAGAMENTO DE FATURA"): defina "natureza" = "TRANSFERENCIA_PROPRIA" e "isPagamentoFatura" = true.
   - LINHAS INFORMATIVAS DE PAGAMENTO EM FATURA DE CARTÃO (BUG-13): Em faturas de cartão de crédito, linhas como "PAGAMENTO RECEBIDO", "CRÉDITO DE PAGAMENTO DE FATURA", "PAGAMENTO EFETUADO" são compensações informativas da fatura e NÃO geram movimentação de caixa (pois o débito ocorre na conta corrente). Defina "natureza" = "TRANSFERENCIA_PROPRIA", "isPagamentoFatura" = true e "observacao" = "Informativo de quitação em fatura de cartão".
   - Créditos de salário ou proventos de empresa (ex: "TED CONTA SALARIO", "CRED SALARIO", "PLR", "REMUNERACAO", "FOLHA DE PAGAMENTO", "BONUS SALARIAL") são SEMPRE RECEITA operacional, mesmo quando o nome do titular constar na linha como favorecido/remetente da conta salário.
   - Só classifique PIX/TED como "TRANSFERENCIA_PROPRIA" quando o documento declarar explicitamente que as contas têm a mesma titularidade ou que a conta de destino também pertence ao titular. Não infira titularidade por nome completo, sobrenome, nome parcial, favorecido ou alias de conta. Se for pagamento a outra pessoa ou não houver prova de titularidade comum, mantenha a natureza de despesa/receita indicada pelo sentido da movimentação. Resgates de aplicação/investimento só são transferência própria se o documento identificar que retornam a uma aplicação do mesmo titular.
   - Para aplicações financeiras, aportes, investimentos e compras de ativos (ex: "APLICAÇÃO", "APLICACAO", "CDB", "RDB", "LCI", "LCA", "TESOURO DIRETO", "DEPOSITO POUPANCA", "COMPRA ACOES", "INVESTIMENTO"): defina categoricamente "natureza" = "APORTE_PATRIMONIAL" (NUNCA classifique como DESPESA!).
   - Para compras ou despesas normais: "natureza" = "DESPESA".
   - Para salários, PLR, rendimentos de aplicações, transferências recebidas de terceiros: "natureza" = "RECEITA".
3. Formato da Data e Regra de Ouro para Cartões:
   - Formato estrito: "YYYY-MM-DD". Se a linha trouxer apenas DD/MM, use o ano do período do extrato ou das datas de movimentação próximas na mesma tabela; use o ano de referência ("${contexto.dataReferencia.substring(0, 4)}") somente quando o documento não der contexto melhor.
   - Identifique a data da própria movimentação. Não use datas de emissão, geração, impressão, exportação, cabeçalho, rodapé ou identificação do modelo do documento como data de lançamento. Não escolha o ano apenas por ser o mais frequente no arquivo inteiro: considere a frequência somente entre datas que pertencem às linhas de movimentação e confira o período do documento.
   - Quando uma tabela mostrar a data uma vez e as linhas seguintes forem continuação do mesmo grupo, aplique essa data às linhas sem data até aparecer outra data explícita. Não transforme uma data omitida em dia 1. Não confunda períodos citados na descrição (por exemplo, período de cálculo de tarifa/encargo) com a data do lançamento.
   - Se o texto incluir contexto de uma página ou trecho anterior, use-o apenas para interpretar a data e a continuidade da tabela; extraia transações somente do trecho atual.
   - REGRA PARA FATURAS DE CARTÃO DE CRÉDITO:
     * Para COMPRAS À VISTA (sem parcelas) ocorridas no ciclo recente da fatura: a "dataMovimento" DEVE ser a data exata da transação (compra).
     * Para COMPRAS PARCELADAS (ex: "Parcela 2/10", "01/03", "5 de 6"): a exigibilidade financeira e o débito desta parcela ocorrem na fatura atual. Portanto, a "dataMovimento" deve ser atribuída ao mês e ano da fatura (usando o dia de fechamento/vencimento ou dataReferencia "${contexto.dataReferencia}"), preservando a data da compra original no texto da descrição/observação. NUNCA aloque uma parcela cobrada na fatura atual para um mês ou ano anterior!
4. Formato de Valor: número decimal estritamente positivo (ponto como separador, ex: 125.50). Desconsidere ou não inclua linhas informativas com valor R$ 0,00 ou cupons de 100% de desconto.
5. Parcelamento: Se houver indicação de parcela (ex: "01/03", "3/10", "parcela 2 de 5"), preencha "parcelaAtual" e "totalParcelas".
6. Contas disponíveis do usuário:
${contasFormatadas}
Use somente os dados da conta/cartão explicitamente presentes no documento e as contas disponíveis do usuário; não infira conta, produto ou layout a partir da marca da instituição.
Classifique a origem pelo tipo de seção/conta em que cada movimentação está listada: CONTA_CORRENTE, POUPANCA, INVESTIMENTO ou CARTAO_CREDITO. Uma movimentação de aplicação CDB listada na seção de conta corrente continua sendo da CONTA_CORRENTE; use INVESTIMENTO para movimentações listadas na conta/seção de investimento. Inclua movimentações efetivas de poupança, inclusive rendimentos creditados. Não converta saldos anterior/atual, resumos ou subtotais em lançamentos. Se houver contas do usuário compatíveis, use o nome correspondente em "contaSugerida".
Identificação precisa da conta/cartão (BUG-16):
- Se for extrato de conta corrente e houver número da conta/agência legível no cabeçalho ou metadados, extraia apenas os dígitos em "numeroConta" (ex: "010830489" ou "24220973" ou "123456").
- Se for fatura de cartão de crédito e houver indicação do final do cartão/dígitos (ex: "Final 2458", "Cartão 7936"), extraia os últimos dígitos (normalmente 4 dígitos) em "digitosCartao".
- Se for fatura de cartão de crédito e houver indicação do final do cartão/dígitos (ex: "Final 2458", "Cartão 7936"), extraia os últimos dígitos (normalmente 4 dígitos) em "digitosCartao".
7. Categorias disponíveis (POF):
${contexto.categorias.map((c) => `- "${c.nome}"`).join('\n') || '(Nenhuma cadastrada)'}
Preencha "categoriaSugerida" com a categoria mais aderente.
8. Código Identificador da Transação (idOrigem):
- Se o extrato/fatura apresentar código de transação, identificador único, "Nº Documento", "Documento", "NSU", "ID Transação" ou código de autenticação correspondente ao lançamento, extraia esse valor no campo "idOrigem". Isso é crucial para diferenciar e rastrear lançamentos únicos! Se não houver, preencha null.

FORMATO DE RESPOSTA OBRIGATÓRIO (JSON puro):
{
  "transacoes": [
    {
      "dataMovimento": "YYYY-MM-DD",
      "descricao": "string concisa",
      "valor": 99.90,
      "natureza": "DESPESA" | "RECEITA" | "TRANSFERENCIA_PROPRIA" | "APORTE_PATRIMONIAL",
      "contaSugerida": "string ou null",
      "tipoConta": "CONTA_CORRENTE" | "POUPANCA" | "CARTAO_CREDITO" | "INVESTIMENTO" | "OUTRO" | null,
      "numeroConta": "string ou null",
      "digitosCartao": "string ou null",
      "categoriaSugerida": "string ou null",
      "parcelaAtual": number ou null,
      "totalParcelas": number ou null,
      "idOrigem": "string ou null",
      "isPagamentoFatura": boolean,
      "observacao": "string ou null",
      "confianca": number
    }
  ]
}`;

    // Conteúdo da mensagem do usuário (formato OpenAI-compatible).
    // Texto puro ⇒ string; imagem/PDF não estruturado ⇒ array multimodal com
    // `image_url` (data URL base64) ou `file` (data URL base64 application/pdf).
    const base64 = conteudoBuffer.toString('base64');
    let conteudoUsuario: any;

    if (isImagem) {
      const mimeImagem = mimeType && mimeType.startsWith('image/') ? mimeType : effectiveMime;
      conteudoUsuario = [
        {
          type: 'text',
          text: `${promptSistema}\n\nAnalise a imagem anexa.`,
        },
        {
          type: 'image_url',
          image_url: { url: `data:${mimeImagem};base64,${base64}` },
        },
      ];
    } else if (isPdf && !textoLegivel) {
      // OpenRouter suporta PDFs em base64 via content type `file` (parse nativo ou OCR interno).
      conteudoUsuario = [
        {
          type: 'text',
          text: `${promptSistema}\n\nAnalise o PDF anexo.`,
        },
        {
          type: 'file',
          file: {
            filename: nomeArquivo,
            file_data: `data:application/pdf;base64,${base64}`,
          },
        },
      ];
    } else {
      conteudoUsuario = `Documento financeiro a analisar:\n"""\n${texto}\n"""`;
    }

    const body = {
      model: mod,
      messages: [
        { role: 'system', content: promptSistema },
        { role: 'user', content: conteudoUsuario },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 8192,
    };

    const res = await fetchIaResiliente(url, {
      method: 'POST',
      headers: montarHeadersOpenRouter(key),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erro na API OpenRouter (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as any;
    const rawText = data.choices?.[0]?.message?.content;
    if (!rawText) {
      throw new Error('A resposta do OpenRouter não continha texto de saída.');
    }
    // TASK-49: contagem real de tokens devolvida pelo provedor (usage)
    const tokens = tokensDeUsageOpenAi(data.usage);

    let parsedJson: any;
    try {
      parsedJson = JSON.parse(rawText);
    } catch {
      throw new Error(`A resposta do OpenRouter gerou JSON incompleto ou inválido: ${rawText.slice(-100)}`);
    }
    const lista = Array.isArray(parsedJson) ? parsedJson : parsedJson.transacoes || [];

    const transacoes = lista
      .map((t: any) => ({
        dataMovimento: t.dataMovimento || contexto.dataReferencia,
        descricao: String(t.descricao || 'Lançamento extraído'),
        valor: Math.abs(Number(t.valor) || 0),
        natureza: t.natureza || 'DESPESA',
        contaSugerida: t.contaSugerida || null,
        tipoConta: t.tipoConta || null,
        categoriaSugerida: t.categoriaSugerida || null,
        parcelaAtual: t.parcelaAtual ? Number(t.parcelaAtual) : null,
        totalParcelas: t.totalParcelas ? Number(t.totalParcelas) : null,
        idOrigem: t.idOrigem ? String(t.idOrigem) : null,
        isPagamentoFatura: Boolean(t.isPagamentoFatura),
        observacao: t.observacao || null,
        confianca: Number(t.confianca ?? 0.95),
      }))
      .filter((t: LancamentoConsolidadoIa) => t.valor > 0);

    return { transacoes: validarTransacoesDoChunk(transacoes), tokens };
  }

  private async chamarGeminiApi(
    nomeArquivo: string,
    mimeType: string | null | undefined,
    conteudoBuffer: Buffer,
    contexto: {
      contas: { id: string; nome: string; tipo: string; numeroConta?: string | null; agencia?: string | null }[];
      categorias: { id: string; nome: string }[];
      dataReferencia: string;
      nomeTitular?: string | null;
      classificacaoDocumento?: ClassificacaoDocumentoWorker;
      instrucoesSkillDocumento?: string;
    },
    textoProcessado?: string,
    apiKeyOverride?: string,
    modelOverride?: string
  ): Promise<{ transacoes: LancamentoConsolidadoIa[]; tokens: TokensIa }> {
    const key = apiKeyOverride || this.apiKey;
    const mod = modelOverride || this.model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${mod}:generateContent?key=${key}`;

    const titularInfo = contexto.nomeTitular ? `Nome do titular da conta: "${contexto.nomeTitular}".` : '';

    const contasFormatadas = contexto.contas
      .map((c) => {
        let det = `- "${c.nome}" (Tipo: ${c.tipo}`;
        if (c.agencia) det += `, Agência: ${c.agencia}`;
        if (c.numeroConta) det += `, Conta: ${c.numeroConta}`;
        det += ')';
        return det;
      })
      .join('\n') || '(Nenhuma cadastrada)';

    const promptSistema = `Você é o extrator inteligente e especialista financeiro do sistema Evolvi.
Sua missão é extrair rigorosamente TODAS as transações financeiras (despesas, receitas, faturas, pagamentos, transferências) contidas no documento ou extrato anexo.
${contexto.instrucoesSkillDocumento || ''}
Classificação feita previamente pelo worker (fonte de verdade; não reidentifique nem altere): instituição ${contexto.classificacaoDocumento?.instituicao || 'não identificada'}; tipo ${contexto.classificacaoDocumento?.tipoDocumento || 'não identificado'}. Use a instituição somente como contexto e classifique cada lançamento pela seção/conta indicada no documento.
${titularInfo}

DIRETRIZES FUNDAMENTAIS:
1. Extração Exaustiva: Não omita nenhuma linha ou lançamento financeiro real. Cada compra, débito, crédito ou movimentação deve gerar um item no array "transacoes".
2. Anti-dupla contagem e Mesma Titularidade:
   - Se for pagamento de fatura de cartão de crédito em extrato bancário de conta corrente (ex: "PAGTO FATURA", "PGTO CARTAO", "PAGAMENTO DE FATURA"): defina "natureza" = "TRANSFERENCIA_PROPRIA" e "isPagamentoFatura" = true.
   - LINHAS INFORMATIVAS DE PAGAMENTO EM FATURA DE CARTÃO (BUG-13): Em faturas de cartão de crédito, linhas como "PAGAMENTO RECEBIDO", "CRÉDITO DE PAGAMENTO DE FATURA", "PAGAMENTO EFETUADO" são compensações informativas da fatura e NÃO geram movimentação de caixa (pois o débito ocorre na conta corrente). Defina "natureza" = "TRANSFERENCIA_PROPRIA", "isPagamentoFatura" = true e "observacao" = "Informativo de quitação em fatura de cartão".
   - Créditos de salário ou proventos de empresa (ex: "TED CONTA SALARIO", "CRED SALARIO", "PLR", "REMUNERACAO", "FOLHA DE PAGAMENTO", "BONUS SALARIAL") são SEMPRE RECEITA operacional, mesmo quando o nome do titular constar na linha como favorecido/remetente da conta salário.
   - Só classifique PIX/TED como "TRANSFERENCIA_PROPRIA" quando o documento declarar explicitamente que as contas têm a mesma titularidade ou que a conta de destino também pertence ao titular. Não infira titularidade por nome completo, sobrenome, nome parcial, favorecido ou alias de conta. Se for pagamento a outra pessoa ou não houver prova de titularidade comum, mantenha a natureza de despesa/receita indicada pelo sentido da movimentação. Resgates de aplicação/investimento só são transferência própria se o documento identificar que retornam a uma aplicação do mesmo titular.
   - Para aplicações financeiras, aportes, investimentos e compras de ativos (ex: "APLICAÇÃO", "APLICACAO", "CDB", "RDB", "LCI", "LCA", "TESOURO DIRETO", "DEPOSITO POUPANCA", "COMPRA ACOES", "INVESTIMENTO"): defina categoricamente "natureza" = "APORTE_PATRIMONIAL" (NUNCA classifique como DESPESA!).
   - Para compras ou despesas normais: "natureza" = "DESPESA".
   - Para salários, PLR, rendimentos de aplicações, transferências recebidas de terceiros: "natureza" = "RECEITA".
3. Formato da Data e Regra de Ouro para Cartões:
   - Formato estrito: "YYYY-MM-DD". Se a linha trouxer apenas DD/MM, use o ano do período do extrato ou das datas de movimentação próximas na mesma tabela; use o ano de referência ("${contexto.dataReferencia.substring(0, 4)}") somente quando o documento não der contexto melhor.
   - Identifique a data da própria movimentação. Não use datas de emissão, geração, impressão, exportação, cabeçalho, rodapé ou identificação do modelo do documento como data de lançamento. Não escolha o ano apenas por ser o mais frequente no arquivo inteiro: considere a frequência somente entre datas que pertencem às linhas de movimentação e confira o período do documento.
   - Quando uma tabela mostrar a data uma vez e as linhas seguintes forem continuação do mesmo grupo, aplique essa data às linhas sem data até aparecer outra data explícita. Não transforme uma data omitida em dia 1. Não confunda períodos citados na descrição (por exemplo, período de cálculo de tarifa/encargo) com a data do lançamento.
   - Se o texto incluir contexto de uma página ou trecho anterior, use-o apenas para interpretar a data e a continuidade da tabela; extraia transações somente do trecho atual.
   - REGRA PARA FATURAS DE CARTÃO DE CRÉDITO:
     * Para COMPRAS À VISTA (sem parcelas) ocorridas no ciclo recente da fatura: a "dataMovimento" DEVE ser a data exata da transação (compra).
     * Para COMPRAS PARCELADAS (ex: "Parcela 2/10", "01/03", "5 de 6"): a exigibilidade financeira e o débito desta parcela ocorrem na fatura atual. Portanto, a "dataMovimento" deve ser atribuída ao mês e ano da fatura (usando o dia de fechamento/vencimento ou dataReferencia "${contexto.dataReferencia}"), preservando a data da compra original no texto da descrição/observação. NUNCA aloque uma parcela cobrada na fatura atual para um mês ou ano anterior!
4. Formato de Valor: número decimal estritamente positivo (ponto como separador, ex: 125.50). Desconsidere ou não inclua linhas informativas com valor R$ 0,00 ou cupons de 100% de desconto.
5. Parcelamento: Se houver indicação de parcela (ex: "01/03", "3/10", "parcela 2 de 5"), preencha "parcelaAtual" e "totalParcelas".
6. Contas disponíveis do usuário:
${contasFormatadas}
Use somente os dados da conta/cartão explicitamente presentes no documento e as contas disponíveis do usuário; não infira conta, produto ou layout a partir da marca da instituição.
Classifique a origem pelo tipo de seção/conta em que cada movimentação está listada: CONTA_CORRENTE, POUPANCA, INVESTIMENTO ou CARTAO_CREDITO. Uma movimentação de aplicação CDB listada na seção de conta corrente continua sendo da CONTA_CORRENTE; use INVESTIMENTO para movimentações listadas na conta/seção de investimento. Inclua movimentações efetivas de poupança, inclusive rendimentos creditados. Não converta saldos anterior/atual, resumos ou subtotais em lançamentos. Se houver contas do usuário compatíveis, use o nome correspondente em "contaSugerida".
Identificação precisa da conta/cartão (BUG-16):
- Se for extrato de conta corrente e houver número da conta/agência legível no cabeçalho ou metadados, extraia apenas os dígitos em "numeroConta" (ex: "010830489" ou "24220973" ou "123456").
- Se for fatura de cartão de crédito e houver indicação do final do cartão/dígitos (ex: "Final 2458", "Cartão 7936"), extraia os últimos dígitos (normalmente 4 dígitos) em "digitosCartao".
7. Categorias disponíveis (POF):
${contexto.categorias.map((c) => `- "${c.nome}"`).join('\n') || '(Nenhuma cadastrada)'}
Preencha "categoriaSugerida" com a categoria mais aderente.
8. Código Identificador da Transação (idOrigem):
- Se o extrato/fatura apresentar código de transação, identificador único, "Nº Documento", "Documento", "NSU", "ID Transação" ou código de autenticação correspondente ao lançamento, extraia esse valor no campo "idOrigem". Isso é crucial para diferenciar e rastrear lançamentos únicos! Se não houver, preencha null.

FORMATO DE RESPOSTA OBRIGATÓRIO (JSON puro):
{
  "transacoes": [
    {
      "dataMovimento": "YYYY-MM-DD",
      "descricao": "string concisa",
      "valor": 99.90,
      "natureza": "DESPESA" | "RECEITA" | "TRANSFERENCIA_PROPRIA" | "APORTE_PATRIMONIAL",
      "contaSugerida": "string ou null",
      "tipoConta": "CONTA_CORRENTE" | "POUPANCA" | "CARTAO_CREDITO" | "INVESTIMENTO" | "OUTRO" | null,
      "numeroConta": "string ou null",
      "digitosCartao": "string ou null",
      "categoriaSugerida": "string ou null",
      "parcelaAtual": number ou null,
      "totalParcelas": number ou null,
      "idOrigem": "string ou null",
      "isPagamentoFatura": boolean,
      "observacao": "string ou null",
      "confianca": number
    }
  ]
}`;

    const effectiveMime = mimeType || this.inferirMimeType(nomeArquivo);

    let parts: any[] = [];
    const isTextual =
      Boolean(textoProcessado) ||
      effectiveMime.includes('text') ||
      effectiveMime.includes('csv') ||
      effectiveMime.includes('json') ||
      effectiveMime.includes('ofx') ||
      nomeArquivo.endsWith('.csv') ||
      nomeArquivo.endsWith('.ofx') ||
      nomeArquivo.endsWith('.txt');

    if (isTextual) {
      const texto = textoProcessado || conteudoBuffer.toString('utf-8');
      parts = [
        {
          text: `${promptSistema}\n\nDocumento financeiro a analisar:\n"""\n${texto}\n"""`,
        },
      ];
    } else {
      // Imagens ou PDFs sem texto extraído (multimodal inlineData base64)
      const base64Data = conteudoBuffer.toString('base64');
      parts = [
        { text: promptSistema },
        {
          inlineData: {
            mimeType: effectiveMime,
            data: base64Data,
          },
        },
      ];
    }

    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    };

    const res = await fetchIaResiliente(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erro na API Gemini (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as any;
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      throw new Error('A resposta do Gemini não continha texto de saída.');
    }

    // TASK-49: contagem real de tokens devolvida pelo Gemini (usageMetadata)
    const tokens = tokensDeUsageGemini(data.usageMetadata);

    const parsedJson = JSON.parse(rawText);
    const lista = Array.isArray(parsedJson) ? parsedJson : parsedJson.transacoes || [];

    const transacoes = lista
      .map((t: any) => ({
        dataMovimento: t.dataMovimento || contexto.dataReferencia,
        descricao: String(t.descricao || 'Lançamento extraído'),
        valor: Math.abs(Number(t.valor) || 0),
        natureza: t.natureza || 'DESPESA',
        contaSugerida: t.contaSugerida || null,
        tipoConta: t.tipoConta || null,
        categoriaSugerida: t.categoriaSugerida || null,
        parcelaAtual: t.parcelaAtual ? Number(t.parcelaAtual) : null,
        totalParcelas: t.totalParcelas ? Number(t.totalParcelas) : null,
        idOrigem: t.idOrigem ? String(t.idOrigem) : null,
        isPagamentoFatura: Boolean(t.isPagamentoFatura),
        observacao: t.observacao || null,
        confianca: Number(t.confianca ?? 0.95),
      }))
      .filter((t: LancamentoConsolidadoIa) => t.valor > 0);

    return { transacoes: validarTransacoesDoChunk(transacoes), tokens };
  }

  public extrairLocalDeterministic(params: {
    nomeArquivo: string;
    conteudoBuffer: Buffer;
    conteudoTexto?: string;
    contexto: {
      contas: { id: string; nome: string; tipo: string }[];
      categorias: { id: string; nome: string }[];
      dataReferencia: string;
      nomeTitular?: string | null;
    };
  }): LancamentoConsolidadoIa[] {
    const { nomeArquivo, conteudoBuffer, contexto } = params;
    const ext = path.extname(nomeArquivo).toLowerCase();
    const isPdf =
      ext === '.pdf' ||
      conteudoBuffer.subarray(0, 5).toString('latin1') === '%PDF-';

    let texto = params.conteudoTexto;
    if (!texto && isPdf) {
      texto = PdfTextExtractor.extrairTexto(conteudoBuffer);
    }
    if (!texto && !isPdf) {
      texto = conteudoBuffer.toString('utf-8');
    }
    texto = texto || '';

    // 2. Tentar parser universal (OFX, CSV, JSON)
    if (ext === '.ofx' || ext === '.csv' || ext === '.json' || texto.includes('<OFX>') || texto.includes(';')) {
      const parseRes = this.universalParser.parse(texto, nomeArquivo);
      if (parseRes.transacoes.length > 0) {
        return parseRes.transacoes.map((t) => {
          let natureza: 'DESPESA' | 'RECEITA' | 'TRANSFERENCIA_PROPRIA' | 'APORTE_PATRIMONIAL' = (t.natureza as any) || 'DESPESA';
          const descLower = t.descricao.toLowerCase();
          const tipoContaDeduzido = (parseRes.contaSugerida?.tipo as any) || null;
          const isPagamentoFatura =
            descricaoIndicaPagamentoFatura(t.descricao) ||
            (tipoContaDeduzido === 'CARTAO_CREDITO' && t.isPagamentoFatura);

          if (isPagamentoFatura || descricaoIndicaTransferenciaPropria(t.descricao)) {
            natureza = 'TRANSFERENCIA_PROPRIA';
          } else if (
            descLower.includes('aplicação') ||
            descLower.includes('aplicacao') ||
            descLower.includes('investimento') ||
            descLower.includes('tesouro direto') ||
            descLower.includes('deposito poupanca') ||
            descLower.includes('depósito poupança') ||
            descLower.includes('deposito poupança') ||
            descLower.includes('depósito poupanca') ||
            descLower.includes('compra acoes') ||
            descLower.includes('compra ações') ||
            /\b(cdb|rdb|lci|lca)\b/i.test(descLower)
          ) {
            natureza = 'APORTE_PATRIMONIAL';
          } else if (
            descLower.includes('salario') ||
            descLower.includes('salário') ||
            descLower.includes('conta salario') ||
            descLower.includes('conta salário') ||
            descLower.includes('plr') ||
            descLower.includes('remuneracao') ||
            descLower.includes('remuneração') ||
            descLower.includes('pix recebido') ||
            descLower.includes('ted recebida') ||
            descLower.includes('rendimento')
          ) {
            natureza = 'RECEITA';
          } else if (descLower.includes('restaurante') || descLower.includes('mercado') || descLower.includes('lanche') || descLower.includes('aluguel') || descLower.includes('uber') || descLower.includes('gasolina') || descLower.includes('compra')) {
            natureza = 'DESPESA';
          }

          const isLinhaInformativaFaturaCartao =
            tipoContaDeduzido === 'CARTAO_CREDITO' &&
            (t.isPagamentoFatura ||
              /pag(amento)?\s*(de)?\s*(fat(ura)?|cart[aã]o)|pagamento\s*recebido|cr[eé]dito\s*pagamento/i.test(
                t.descricao
              ));

          let observacao = t.memo || 'Extraído via parser estruturado local';
          if (isLinhaInformativaFaturaCartao) {
            observacao = 'Linha informativa de quitação em fatura de cartão';
          }

          return {
            dataMovimento: t.data,
            descricao: t.descricao,
            valor: t.valor,
            natureza,
            contaSugerida: parseRes.contaSugerida?.nome || null,
            tipoConta: tipoContaDeduzido,
            numeroConta: parseRes.contaSugerida?.numeroConta || null,
            digitosCartao: parseRes.contaSugerida?.digitosCartao || null,
            categoriaSugerida: t.categoriaSugerida || this.deduzirCategoria(t.descricao, contexto.categorias),
            parcelaAtual: null,
            totalParcelas: null,
            idOrigem: t.idExterno || null,
            isPagamentoFatura: Boolean(isPagamentoFatura || isLinhaInformativaFaturaCartao),
            observacao,
            confianca: 0.98,
          };
        });
      }
    }

    // Formatos não estruturados que não casaram com parsers estritos acima não devem
    // sofrer adivinhações por regex ou fallbacks cegos de código.
    return [];
  }

  private inferirMimeType(nome: string): string {
    const ext = path.extname(nome).toLowerCase();
    switch (ext) {
      case '.pdf':
        return 'application/pdf';
      case '.png':
        return 'image/png';
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.csv':
        return 'text/csv';
      case '.json':
        return 'application/json';
      case '.ofx':
        return 'application/x-ofx';
      default:
        return 'text/plain';
    }
  }

  private deduzirCategoria(
    texto: string,
    categorias: { id: string; nome: string }[]
  ): string | null {
    const lower = texto.toLowerCase();
    if (lower.includes('almoço') || lower.includes('mercado') || lower.includes('lanche') || lower.includes('restaurante')) {
      const c = categorias.find((cat) => cat.nome.toLowerCase().includes('aliment'));
      if (c) return c.nome;
    }
    if (lower.includes('uber') || lower.includes('gasolina') || lower.includes('posto') || lower.includes('combustivel')) {
      const c = categorias.find((cat) => cat.nome.toLowerCase().includes('transp'));
      if (c) return c.nome;
    }
    if (lower.includes('aluguel') || lower.includes('condom') || lower.includes('energia') || lower.includes('copel') || lower.includes('luz')) {
      const c = categorias.find((cat) => cat.nome.toLowerCase().includes('habita'));
      if (c) return c.nome;
    }
    return categorias.length > 0 ? categorias[0].nome : null;
  }
}
