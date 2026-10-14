import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../../../infrastructure/database/prisma.js';
import {
  importacaoEventBus,
  ImportacaoEventBus,
  ImportacaoLoteRecepcionadoEvent,
} from '../../../infrastructure/events/importacao-event-bus.js';
import { IIaExtratorClient, GeminiIaExtratorClient } from './ia-extrator.client.js';
import {
  ArquivoConsolidadoIa,
  arquivoConsolidadoIaSchema,
} from './ia-extrator.schema.js';

export interface ProcessamentoArquivoResultado {
  arquivoId: string;
  nomeArquivo: string;
  sucesso: boolean;
  totalTransacoes: number;
  caminhoConsolidado?: string;
  erro?: string;
}

export interface ProcessamentoLoteIaResultado {
  loteId: string;
  totalArquivos: number;
  arquivosProcessadosComSucesso: number;
  arquivosComErro: number;
  resultados: ProcessamentoArquivoResultado[];
}

export class ImportacaoIaWorkerService {
  private isProcessing: boolean = false;
  private isListeningEvents: boolean = false;
  private extratorClient: IIaExtratorClient;
  private baseDir: string;

  private boundListener?: (event: ImportacaoLoteRecepcionadoEvent) => void;

  constructor(extratorClient?: IIaExtratorClient, baseDir: string = process.cwd(), autoListen: boolean = false) {
    this.extratorClient = extratorClient || new GeminiIaExtratorClient();
    this.baseDir = baseDir;
    if (autoListen) {
      this.setupEventListener();
    }
  }

  /**
   * Conecta o ouvinte orientado a eventos do barramento de importação.
   */
  public setupEventListener(): void {
    if (this.isListeningEvents) {
      return;
    }

    this.boundListener = (event: ImportacaoLoteRecepcionadoEvent) => {
      // Processamento assíncrono desacoplado
      this.processarLote(event.loteId).catch((err) => {
        console.error(`[ImportacaoIaWorker] Erro ao processar lote ${event.loteId} via evento:`, err);
      });
    };

    importacaoEventBus.onLoteRecepcionado(this.boundListener);
    this.isListeningEvents = true;
  }

  public removeEventListener(): void {
    if (this.boundListener) {
      importacaoEventBus.removeListener(
        ImportacaoEventBus.EVENT_LOTE_RECEPCIONADO,
        this.boundListener
      );
      this.boundListener = undefined;
      this.isListeningEvents = false;
    }
  }

  /**
   * Processa todos os arquivos de um lote sequencialmente (1 arquivo por vez).
   */
  public async processarLote(loteId: string): Promise<ProcessamentoLoteIaResultado> {
    const lote = await prisma.loteImportacao.findUnique({
      where: { id: loteId },
      include: {
        usuario: {
          select: { id: true },
        },
      },
    });

    if (!lote) {
      throw new Error(`Lote ${loteId} não encontrado.`);
    }

    // Atualiza status do lote para PROCESSANDO_IA
    await prisma.loteImportacao.update({
      where: { id: loteId },
      data: { status: 'PROCESSANDO_IA' },
    });

    // Busca arquivos pendentes (status RECEPCIONADO ou ENVIADO_IA) ordenados por data de criação
    const arquivosPendentes = await prisma.arquivoImportacao.findMany({
      where: {
        loteId,
        status: { in: ['RECEPCIONADO', 'ENVIADO_IA'] },
      },
      orderBy: { criadoEm: 'asc' },
    });

    // Buscar contexto do usuário (contas cadastradas e categorias POF)
    const [contas, categorias] = await Promise.all([
      prisma.conta.findMany({
        where: { usuarioId: lote.usuarioId, ativo: true },
        select: { id: true, nome: true, tipo: true },
      }),
      prisma.categoria.findMany({
        where: {
          OR: [{ usuarioId: null }, { usuarioId: lote.usuarioId }],
        },
        select: { id: true, nome: true },
        orderBy: { ordem: 'asc' },
      }),
    ]);

    const dataReferencia = new Date().toISOString().split('T')[0];
    const contexto = {
      contas,
      categorias,
      dataReferencia,
    };

    const resultados: ProcessamentoArquivoResultado[] = [];

    // PROCESSAMENTO SEQUENCIAL ESTRITO: 1 arquivo por vez
    for (const arquivo of arquivosPendentes) {
      const resultadoArquivo = await this.processarArquivoIndividual({
        lote,
        arquivo,
        contexto,
      });
      resultados.push(resultadoArquivo);

      // Atualiza progresso do lote se ainda existir
      const processadosComSucesso = resultados.filter((r) => r.sucesso).length;
      await prisma.loteImportacao.updateMany({
        where: { id: loteId },
        data: {
          arquivosProcessados: processadosComSucesso,
        },
      });
    }

    // Avalia fechamento do lote
    const erros = resultados.filter((r) => !r.sucesso).length;
    const sucessos = resultados.filter((r) => r.sucesso).length;

    let statusFinalLote: 'PROCESSANDO_IA' | 'ERRO_TOTAL' | 'ERRO_PARCIAL' = 'PROCESSANDO_IA';
    if (erros > 0 && sucessos === 0) {
      statusFinalLote = 'ERRO_TOTAL';
    } else if (erros > 0 && sucessos > 0) {
      statusFinalLote = 'ERRO_PARCIAL';
    }

    await prisma.loteImportacao.updateMany({
      where: { id: loteId },
      data: {
        status: statusFinalLote,
      },
    });

    return {
      loteId,
      totalArquivos: arquivosPendentes.length,
      arquivosProcessadosComSucesso: sucessos,
      arquivosComErro: erros,
      resultados,
    };
  }

  /**
   * Processa um arquivo individual do lote, chama o extrator de IA,
   * valida as transações extraídas, gera o arquivo consolidado físico no disco
   * e emite eventos em tempo real.
   */
  public async processarArquivoIndividual(params: {
    lote: { id: string; usuarioId: string; caminhoDiretorio: string };
    arquivo: {
      id: string;
      nomeArquivo: string;
      caminhoRelativo: string;
      mimeType: string | null;
    };
    contexto: {
      contas: { id: string; nome: string; tipo: string }[];
      categorias: { id: string; nome: string }[];
      dataReferencia: string;
    };
  }): Promise<ProcessamentoArquivoResultado> {
    const { lote, arquivo, contexto } = params;

    try {
      // 1. Atualiza status para ENVIADO_IA
      await prisma.arquivoImportacao.update({
        where: { id: arquivo.id },
        data: { status: 'ENVIADO_IA', mensagemErro: null },
      });

      importacaoEventBus.emitArquivoProgresso({
        loteId: lote.id,
        arquivoId: arquivo.id,
        nomeArquivo: arquivo.nomeArquivo,
        status: 'ENVIADO_IA',
        timestamp: new Date(),
      });

      // 2. Leitura física do arquivo do lote no disco
      const caminhoFisicoArquivo = path.resolve(
        this.baseDir,
        lote.caminhoDiretorio,
        arquivo.caminhoRelativo
      );
      const buffer = await fs.readFile(caminhoFisicoArquivo);

      // 3. Chamada de extração de IA (Gemini ou motor local resiliente)
      const transacoesExtraidas = await this.extratorClient.extrairTransacoes({
        nomeArquivo: arquivo.nomeArquivo,
        mimeType: arquivo.mimeType,
        conteudoBuffer: buffer,
        contexto,
      });

      // 4. Validação estrita: O arquivo só é considerado tratado quando a IA confirmar com sucesso que extraiu todos os registros
      if (!transacoesExtraidas || transacoesExtraidas.length === 0) {
        throw new Error(
          `A IA não identificou transações válidas no documento "${arquivo.nomeArquivo}".`
        );
      }

      // Validação schema Zod
      const payloadConsolidado: ArquivoConsolidadoIa = {
        loteId: lote.id,
        arquivoId: arquivo.id,
        nomeArquivoOrigem: arquivo.nomeArquivo,
        totalTransacoes: transacoesExtraidas.length,
        geradoEm: new Date().toISOString(),
        metadados: {
          provedor: 'GEMINI',
          modelo: 'gemini-2.5-flash',
          tentativas: 1,
        },
        transacoes: transacoesExtraidas,
      };

      const validacao = arquivoConsolidadoIaSchema.safeParse(payloadConsolidado);
      if (!validacao.success) {
        throw new Error(
          `Formato de transações extraídas inválido: ${validacao.error.issues.map((i) => i.message).join(', ')}`
        );
      }

      // 5. Geração do Arquivo Físico Consolidado na pasta do lote
      // Padrão: consolidado_{arquivoId}.json
      const nomeConsolidado = `consolidado_${arquivo.id}.json`;
      const caminhoFisicoConsolidado = path.resolve(
        this.baseDir,
        lote.caminhoDiretorio,
        nomeConsolidado
      );

      await fs.writeFile(
        caminhoFisicoConsolidado,
        JSON.stringify(validacao.data, null, 2),
        'utf-8'
      );

      // 6. Atualização de status no banco para IA_CONCLUIDO
      await prisma.arquivoImportacao.update({
        where: { id: arquivo.id },
        data: {
          status: 'IA_CONCLUIDO',
          mensagemErro: null,
        },
      });

      // 7. Notificações / Eventos de conclusão do arquivo
      importacaoEventBus.emitArquivoProgresso({
        loteId: lote.id,
        arquivoId: arquivo.id,
        nomeArquivo: arquivo.nomeArquivo,
        status: 'IA_CONCLUIDO',
        mensagem: `${transacoesExtraidas.length} transações extraídas e consolidadas com sucesso.`,
        timestamp: new Date(),
      });

      importacaoEventBus.emitArquivoConsolidadoPronto({
        loteId: lote.id,
        arquivoId: arquivo.id,
        usuarioId: lote.usuarioId,
        nomeArquivo: arquivo.nomeArquivo,
        caminhoConsolidado: path.join(lote.caminhoDiretorio, nomeConsolidado),
        totalTransacoes: transacoesExtraidas.length,
        timestamp: new Date(),
      });

      return {
        arquivoId: arquivo.id,
        nomeArquivo: arquivo.nomeArquivo,
        sucesso: true,
        totalTransacoes: transacoesExtraidas.length,
        caminhoConsolidado: caminhoFisicoConsolidado,
      };
    } catch (err: unknown) {
      const mensagemErro = err instanceof Error ? err.message : String(err);

      // Registra erro no banco
      await prisma.arquivoImportacao.update({
        where: { id: arquivo.id },
        data: {
          status: 'ERRO',
          mensagemErro,
        },
      });

      importacaoEventBus.emitArquivoProgresso({
        loteId: lote.id,
        arquivoId: arquivo.id,
        nomeArquivo: arquivo.nomeArquivo,
        status: 'ERRO',
        mensagem: mensagemErro,
        timestamp: new Date(),
      });

      return {
        arquivoId: arquivo.id,
        nomeArquivo: arquivo.nomeArquivo,
        sucesso: false,
        totalTransacoes: 0,
        erro: mensagemErro,
      };
    }
  }
}

export const importacaoIaWorkerService = new ImportacaoIaWorkerService();
