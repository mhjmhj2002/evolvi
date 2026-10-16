import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../../../infrastructure/database/prisma.js';
import {
  importacaoEventBus,
  ImportacaoEventBus,
  ImportacaoArquivoConsolidadoProntoEvent,
} from '../../../infrastructure/events/importacao-event-bus.js';
import {
  ArquivoConsolidadoIa,
  arquivoConsolidadoIaSchema,
} from './ia-extrator.schema.js';

export interface CargaStagingResultado {
  loteId: string;
  arquivoId: string;
  nomeArquivo: string;
  sucesso: boolean;
  totalLinhasCarregadas: number;
  erro?: string;
}

export class ImportacaoStagingWorkerService {
  private baseDir: string;
  private isListeningEvents: boolean = false;
  private boundListener?: (event: ImportacaoArquivoConsolidadoProntoEvent) => void;

  constructor(baseDir: string = process.cwd(), autoListen: boolean = false) {
    this.baseDir = baseDir;
    if (autoListen) {
      this.setupEventListener();
    }
  }

  /**
   * Conecta o ouvinte orientado a eventos do barramento de importação.
   * Quando um arquivo consolidado estiver pronto, o Worker 2 carrega imediatamente para a staging.
   */
  public setupEventListener(): void {
    if (this.isListeningEvents) {
      return;
    }

    this.boundListener = (event: ImportacaoArquivoConsolidadoProntoEvent) => {
      this.carregarArquivoParaStaging(event.arquivoId, event.usuarioId).catch((err) => {
        console.error(
          `[ImportacaoStagingWorker] Erro ao carregar arquivo ${event.arquivoId} para staging:`,
          err
        );
      });
    };

    importacaoEventBus.onArquivoConsolidadoPronto(this.boundListener);
    this.isListeningEvents = true;
  }

  public removeEventListener(): void {
    if (this.boundListener) {
      importacaoEventBus.removeListener(
        ImportacaoEventBus.EVENT_ARQUIVO_CONSOLIDADO_PRONTO,
        this.boundListener
      );
      this.boundListener = undefined;
      this.isListeningEvents = false;
    }
  }

  /**
   * Carrega os dados de um arquivo consolidado físico diretamente para a tabela de staging.
   */
  public async carregarArquivoParaStaging(
    arquivoId: string,
    usuarioIdEsperado?: string
  ): Promise<CargaStagingResultado> {
    const arquivo = await prisma.arquivoImportacao.findUnique({
      where: { id: arquivoId },
      include: {
        lote: true,
      },
    });

    if (!arquivo) {
      throw new Error(`Arquivo de importação [${arquivoId}] não encontrado.`);
    }

    // Isolamento multi-tenant
    if (usuarioIdEsperado && arquivo.lote.usuarioId !== usuarioIdEsperado) {
      throw new Error(
        `Violação de isolamento multi-tenant: arquivo ${arquivoId} pertence a outro usuário.`
      );
    }

    // Atualiza status do lote para CARGA_STAGING se ainda estiver em etapas anteriores
    if (['RECEPCIONADO', 'PROCESSANDO_IA'].includes(arquivo.lote.status)) {
      await prisma.loteImportacao.update({
        where: { id: arquivo.loteId },
        data: { status: 'CARGA_STAGING' },
      });
    }

    const nomeConsolidado = `consolidado_${arquivo.id}.json`;
    const caminhoFisicoConsolidado = path.resolve(
      this.baseDir,
      arquivo.lote.caminhoDiretorio,
      nomeConsolidado
    );

    try {
      const conteudoJson = await fs.readFile(caminhoFisicoConsolidado, 'utf-8');
      const dadosConsolidados = JSON.parse(conteudoJson) as ArquivoConsolidadoIa;

      const validacao = arquivoConsolidadoIaSchema.safeParse(dadosConsolidados);
      if (!validacao.success) {
        throw new Error(
          `Arquivo consolidado corrompido ou inválido: ${validacao.error.issues
            .map((i) => i.message)
            .join(', ')}`
        );
      }

      const transacoes = validacao.data.transacoes;

      // Bulk insert atômico na tabela de staging
      await prisma.$transaction(async (tx) => {
        // Remove eventuais registros prévios do mesmo arquivo para garantir idempotência
        await tx.stagingLancamentoImportacao.deleteMany({
          where: { arquivoId: arquivo.id },
        });

        // Prepara dados e executa bulk insert atômico via createMany
        const registrosParaInserir = transacoes.map((txItem) => {
          const dataMovimentoDate = new Date(`${txItem.dataMovimento}T00:00:00.000Z`);

          let tipoContaFinal: 'CONTA_CORRENTE' | 'CARTAO_CREDITO' | 'INVESTIMENTO' | null = null;
          if (txItem.tipoConta === 'CARTAO_CREDITO') {
            tipoContaFinal = 'CARTAO_CREDITO';
          } else if (txItem.tipoConta === 'CONTA_CORRENTE') {
            tipoContaFinal = 'CONTA_CORRENTE';
          } else if (txItem.tipoConta === 'INVESTIMENTO') {
            tipoContaFinal = 'INVESTIMENTO';
          }

          // BUG-13: Se for linha de pagamento recebido/quitação dentro de fatura de cartão de crédito,
          // deve ser marcado como IGNORADO para não duplicar com o débito da conta corrente
          const isQuitaçãoFaturaCartao =
            tipoContaFinal === 'CARTAO_CREDITO' &&
            (txItem.isPagamentoFatura ||
              /pag(amento)?\s*(de)?\s*(fat(ura)?|cart[aã]o)|pagamento\s*recebido|cr[eé]dito\s*pagamento/i.test(
                txItem.descricao
              ) ||
              /informativ[ao]\s*de\s*quita[cç][aã]o/i.test(txItem.observacao || ''));

          const statusProcessamento = isQuitaçãoFaturaCartao ? ('IGNORADO' as const) : ('PENDENTE' as const);
          const observacaoFinal = isQuitaçãoFaturaCartao
            ? 'Linha informativa de pagamento em fatura de cartão (ignorado para evitar dupla contagem com débito em conta)'
            : txItem.observacao || null;

          return {
            loteId: arquivo.loteId,
            arquivoId: arquivo.id,
            arquivoOrigem: arquivo.nomeArquivo,
            dataMovimento: dataMovimentoDate,
            descricao: txItem.descricao,
            valor: txItem.valor,
            natureza: txItem.natureza,
            contaSugerida: txItem.contaSugerida || null,
            tipoConta: tipoContaFinal,
            categoriaSugerida: txItem.categoriaSugerida || null,
            parcelaAtual: txItem.parcelaAtual || null,
            totalParcelas: txItem.totalParcelas || null,
            idOrigem: txItem.idOrigem || null,
            observacao: observacaoFinal,
            statusProcessamento,
          };
        });

        if (registrosParaInserir.length > 0) {
          await tx.stagingLancamentoImportacao.createMany({
            data: registrosParaInserir,
          });
        }

        // Atualiza status do arquivo para STAGING_CARREGADO
        await tx.arquivoImportacao.update({
          where: { id: arquivo.id },
          data: {
            status: 'STAGING_CARREGADO',
            mensagemErro: null,
          },
        });
      });

      // Emite evento de progresso e de conclusão da staging
      importacaoEventBus.emitArquivoProgresso({
        loteId: arquivo.loteId,
        arquivoId: arquivo.id,
        nomeArquivo: arquivo.nomeArquivo,
        status: 'STAGING_CARREGADO',
        mensagem: `${transacoes.length} registros inseridos com sucesso na tabela de staging.`,
        timestamp: new Date(),
      });

      importacaoEventBus.emitArquivoStagingCarregado({
        loteId: arquivo.loteId,
        arquivoId: arquivo.id,
        usuarioId: arquivo.lote.usuarioId,
        nomeArquivo: arquivo.nomeArquivo,
        totalLinhasStaging: transacoes.length,
        timestamp: new Date(),
      });

      return {
        loteId: arquivo.loteId,
        arquivoId: arquivo.id,
        nomeArquivo: arquivo.nomeArquivo,
        sucesso: true,
        totalLinhasCarregadas: transacoes.length,
      };
    } catch (err: unknown) {
      const mensagemErro = err instanceof Error ? err.message : String(err);

      await prisma.arquivoImportacao.update({
        where: { id: arquivo.id },
        data: {
          status: 'ERRO',
          mensagemErro,
        },
      });

      importacaoEventBus.emitArquivoProgresso({
        loteId: arquivo.loteId,
        arquivoId: arquivo.id,
        nomeArquivo: arquivo.nomeArquivo,
        status: 'ERRO',
        mensagem: `Erro na carga de staging: ${mensagemErro}`,
        timestamp: new Date(),
      });

      return {
        loteId: arquivo.loteId,
        arquivoId: arquivo.id,
        nomeArquivo: arquivo.nomeArquivo,
        sucesso: false,
        totalLinhasCarregadas: 0,
        erro: mensagemErro,
      };
    }
  }

  /**
   * Processa a carga de staging de todos os arquivos de um lote que já estejam em IA_CONCLUIDO.
   */
  public async carregarLoteParaStaging(loteId: string, usuarioId?: string): Promise<CargaStagingResultado[]> {
    const lote = await prisma.loteImportacao.findUnique({
      where: { id: loteId },
      include: {
        arquivos: {
          where: {
            status: 'IA_CONCLUIDO',
          },
          orderBy: { criadoEm: 'asc' },
        },
      },
    });

    if (!lote) {
      throw new Error(`Lote [${loteId}] não encontrado.`);
    }

    if (usuarioId && lote.usuarioId !== usuarioId) {
      throw new Error(`Violação de isolamento multi-tenant: lote ${loteId} pertence a outro usuário.`);
    }

    const resultados: CargaStagingResultado[] = [];
    for (const arquivo of lote.arquivos) {
      const res = await this.carregarArquivoParaStaging(arquivo.id, lote.usuarioId);
      resultados.push(res);
    }

    return resultados;
  }
}

export const importacaoStagingWorkerService = new ImportacaoStagingWorkerService();
