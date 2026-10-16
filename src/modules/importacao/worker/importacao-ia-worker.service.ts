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
import { PdfTextExtractor } from '../../conector/parsers/pdf-text-extractor.js';


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
      this.processarLote(event.loteId, {
        provedorIa: event.provedorIa,
        modeloIa: event.modeloIa,
      }).catch((err) => {
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
  public async processarLote(
    loteId: string,
    opcoes?: { provedorIa?: string; modeloIa?: string }
  ): Promise<ProcessamentoLoteIaResultado> {
    const lote = await prisma.loteImportacao.findUnique({
      where: { id: loteId },
      include: {
        usuario: {
          select: { id: true, nome: true },
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
      nomeTitular: lote.usuario?.nome || null,
    };

    const resultados: ProcessamentoArquivoResultado[] = [];

    // PROCESSAMENTO SEQUENCIAL ESTRITO: 1 arquivo por vez
    for (const arquivo of arquivosPendentes) {
      const resultadoArquivo = await this.processarArquivoIndividual({
        lote,
        arquivo,
        contexto,
        provedorIa: opcoes?.provedorIa,
        modeloIa: opcoes?.modeloIa,
      });
      resultados.push(resultadoArquivo);

      // Atualiza progresso do lote contando todos os arquivos já concluídos com sucesso no lote
      const totalProcessadosNoLote = await prisma.arquivoImportacao.count({
        where: {
          loteId,
          status: { in: ['IA_CONCLUIDO', 'STAGING_CARREGADO', 'PROCESSADO_FINAL'] },
        },
      });
      await prisma.loteImportacao.updateMany({
        where: { id: loteId },
        data: {
          arquivosProcessados: totalProcessadosNoLote,
        },
      });
    }

    // Avalia fechamento do lote em caso de falha catastrófica de todos os arquivos
    const erros = resultados.filter((r) => !r.sucesso).length;
    const sucessos = resultados.filter((r) => r.sucesso).length;

    if (erros > 0 && sucessos === 0) {
      await prisma.loteImportacao.updateMany({
        where: { id: loteId },
        data: {
          status: 'ERRO_TOTAL',
        },
      });
    }

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
      nomeTitular?: string | null;
    };
    provedorIa?: string;
    modeloIa?: string;
  }): Promise<ProcessamentoArquivoResultado> {
    const { lote, arquivo, contexto, provedorIa, modeloIa } = params;

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

      // 3. Chamada de extração de IA (com provedor e chave segura do usuário no banco)
      const transacoesExtraidas = await this.extratorClient.extrairTransacoes({
        nomeArquivo: arquivo.nomeArquivo,
        mimeType: arquivo.mimeType,
        conteudoBuffer: buffer,
        usuarioId: lote.usuarioId,
        provedorIa,
        modeloIa,
        contexto,
      });

      // 4. Validação e Reconhecimento de Documento Válido sem Movimentação (BUG-08)
      if (!transacoesExtraidas || transacoesExtraidas.length === 0) {
        // Verifica se é um documento financeiro legítimo sem movimentação (ex: CSV apenas com cabeçalho ou fatura zerada R$ 0,00)
        let isDocumentoVazioLegitimo = false;
        const ext = path.extname(arquivo.nomeArquivo).toLowerCase();

        if (ext === '.csv' || ext === '.ofx' || ext === '.json') {
          const texto = buffer.toString('utf-8').trim();
          const linhas = texto.split(/\r?\n/).filter((l) => l.trim().length > 0);
          if (linhas.length <= 1) {
            isDocumentoVazioLegitimo = true;
          }
        }

        if (ext === '.pdf') {
          const textoPdf = PdfTextExtractor.extrairTexto(buffer);
          if (
            textoPdf &&
            (/voc[eê]\s+n[aã]o\s+consumiu\s+nada/i.test(textoPdf) ||
              /total\s+(a\s+pagar|da\s+fatura)[\s\S]{0,50}r\$\s*0[,.]00/i.test(textoPdf) ||
              /n[aã]o\s+h[aá]\s+gastos\s+pendentes/i.test(textoPdf))
          ) {
            isDocumentoVazioLegitimo = true;
          }
        }

        if (isDocumentoVazioLegitimo) {
          // Documento válido sem lançamentos no período (ex: fatura zerada ou mês sem movimentação)
          await prisma.arquivoImportacao.update({
            where: { id: arquivo.id },
            data: {
              status: 'PROCESSADO_FINAL',
              mensagemErro: null,
            },
          });

          importacaoEventBus.emitArquivoProgresso({
            loteId: lote.id,
            arquivoId: arquivo.id,
            nomeArquivo: arquivo.nomeArquivo,
            status: 'PROCESSADO_FINAL',
            mensagem: 'Documento financeiro válido sem movimentação ou com total R$ 0,00 no período (CONCLUIDO_VAZIO).',
            timestamp: new Date(),
          });

          return {
            arquivoId: arquivo.id,
            nomeArquivo: arquivo.nomeArquivo,
            sucesso: true,
            totalTransacoes: 0,
          };
        }

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
          provedor: provedorIa || 'GEMINI',
          modelo: modeloIa || 'gemini-3.8-flash',
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

  /**
   * Reprocessa individualmente um arquivo com falha (status ERRO) usando a IA e modelo informados.
   * Não afeta o progresso dos demais arquivos já concluídos do lote.
   */
  public async reprocessarArquivoIndividualComIa(params: {
    arquivoId: string;
    usuarioId: string;
    provedorIa?: string;
    modeloIa?: string;
  }): Promise<ProcessamentoArquivoResultado> {
    const { arquivoId, usuarioId, provedorIa, modeloIa } = params;

    // Busca o arquivo garantindo posse do lote pelo usuário (segurança multi-tenant)
    const arquivo = await prisma.arquivoImportacao.findFirst({
      where: {
        id: arquivoId,
        lote: {
          usuarioId,
        },
      },
      include: {
        lote: {
          select: {
            id: true,
            usuarioId: true,
            caminhoDiretorio: true,
            status: true,
          },
        },
      },
    });

    if (!arquivo) {
      throw new Error(`Arquivo ${arquivoId} não encontrado ou não pertence ao usuário.`);
    }

    // Limpeza imediata de mensagem de erro anterior no reprocessamento
    await prisma.arquivoImportacao.update({
      where: { id: arquivoId },
      data: { mensagemErro: null },
    });

    // Busca contexto do usuário (contas cadastradas, categorias POF e perfil do usuário)
    const [usuario, contas, categorias] = await Promise.all([
      prisma.usuario.findUnique({
        where: { id: usuarioId },
        select: { id: true, nome: true },
      }),
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

    const dataReferencia = new Date().toISOString().split('T')[0];
    const contexto = {
      contas,
      categorias,
      dataReferencia,
      nomeTitular: usuario?.nome || null,
    };

    // Executa a extração para este arquivo individual
    const resultado = await this.processarArquivoIndividual({
      lote: arquivo.lote,
      arquivo: {
        id: arquivo.id,
        nomeArquivo: arquivo.nomeArquivo,
        caminhoRelativo: arquivo.caminhoRelativo,
        mimeType: arquivo.mimeType,
      },
      contexto,
      provedorIa,
      modeloIa,
    });

    // Se o arquivo teve sucesso, recalcula contadores e restaura status do lote se necessário
    if (resultado.sucesso) {
      const arquivosDoLote = await prisma.arquivoImportacao.findMany({
        where: { loteId: arquivo.lote.id },
        select: { status: true },
      });

      const concluidos = arquivosDoLote.filter((a) =>
        ['IA_CONCLUIDO', 'STAGING_CARREGADO', 'PROCESSADO_FINAL'].includes(a.status)
      ).length;

      const erros = arquivosDoLote.filter((a) => a.status === 'ERRO').length;

      // Se o lote estava em ERRO_TOTAL ou ERRO_PARCIAL e agora tem arquivos com sucesso:
      let novoStatusLote = arquivo.lote.status;
      if (arquivo.lote.status === 'ERRO_TOTAL') {
        novoStatusLote = 'PROCESSANDO_IA';
      } else if (arquivo.lote.status === 'ERRO_PARCIAL' && erros === 0) {
        novoStatusLote = 'PROCESSANDO_IA';
      }

      await prisma.loteImportacao.update({
        where: { id: arquivo.lote.id },
        data: {
          arquivosProcessados: concluidos,
          status: novoStatusLote,
        },
      });
    }

    return resultado;
  }
}

export const importacaoIaWorkerService = new ImportacaoIaWorkerService();
