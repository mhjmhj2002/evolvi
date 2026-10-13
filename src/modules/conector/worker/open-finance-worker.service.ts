import { prisma } from '../../../infrastructure/database/prisma.js';
import { openFinanceEventBus, OpenFinanceRawIngestedEvent } from '../../../infrastructure/events/open-finance-event-bus.js';
import { NormalizationPipelineService } from '../pipeline/normalization-pipeline.service.js';
import { BankAccountRaw, BankTransactionRaw, BankInvoiceRaw } from '../types/bank-connector.interface.js';

export interface ProcessamentoItemResultado {
  dadoBrutoId: string;
  tipoDado: string;
  sucesso: boolean;
  novosMovimentosInseridos: number;
  duplicadasIgnoradas: number;
  pagamentosFaturaConvertidos: number;
  erro?: string;
  tentativas: number;
  enviadoParaDLQ: boolean;
}

export interface SweepProcessamentoResultado {
  totalPendentesEncontrados: number;
  processadosSucesso: number;
  processadosComErro: number;
  itens: ProcessamentoItemResultado[];
  duracaoMs: number;
}

export class OpenFinanceWorkerService {
  private timerSweep: NodeJS.Timeout | null = null;
  private isProcessingSweep: boolean = false;
  private maxRetries: number = 3;
  private pipeline = new NormalizationPipelineService();
  private isListeningEvents: boolean = false;

  constructor() {
    this.setupEventListener();
  }

  /**
   * Configura o ouvinte orientado a eventos para reagir a pings do scheduler
   */
  public setupEventListener(): void {
    if (this.isListeningEvents) {
      return;
    }

    openFinanceEventBus.onRawIngested((event: OpenFinanceRawIngestedEvent) => {
      // Execução assíncrona desacoplada sem travar o emissor
      this.processarLoteIngestado(event).catch((err) => {
        console.error(`[OpenFinanceWorker] Erro ao processar lote ${event.loteId} via evento:`, err);
      });
    });

    this.isListeningEvents = true;
  }

  /**
   * Inicia o worker com sweep periódico de segurança (recuperação de falhas e registros pendentes)
   */
  public start(intervalSweepMs: number = 5 * 60 * 1000, maxRetries: number = 3): void {
    if (this.timerSweep) {
      return;
    }
    this.maxRetries = maxRetries;

    this.timerSweep = setInterval(() => {
      this.executarSweepSeguranca().catch((err) => {
        console.error('[OpenFinanceWorker] Erro no sweep de segurança periódico:', err);
      });
    }, intervalSweepMs);

    if (this.timerSweep.unref) {
      this.timerSweep.unref();
    }
  }

  /**
   * Para o worker e seu timer de sweep
   */
  public stop(): void {
    if (this.timerSweep) {
      clearInterval(this.timerSweep);
      this.timerSweep = null;
    }
  }

  /**
   * Processa o lote de dados brutos recém-notificado pelo evento da TASK-28
   */
  public async processarLoteIngestado(event: OpenFinanceRawIngestedEvent): Promise<ProcessamentoItemResultado[]> {
    const resultados: ProcessamentoItemResultado[] = [];

    for (const dadoBrutoId of event.dadosBrutosIds) {
      try {
        const res = await this.processarRegistroDadoBruto(dadoBrutoId, event.usuarioId);
        resultados.push(res);
      } catch (err: unknown) {
        const mensagemErro = err instanceof Error ? err.message : String(err);
        resultados.push({
          dadoBrutoId,
          tipoDado: 'DESCONHECIDO',
          sucesso: false,
          novosMovimentosInseridos: 0,
          duplicadasIgnoradas: 0,
          pagamentosFaturaConvertidos: 0,
          erro: mensagemErro,
          tentativas: 1,
          enviadoParaDLQ: false,
        });
      }
    }

    return resultados;
  }

  /**
   * Processa um registro específico de DadoBrutoOpenFinance com concorrência segura (transição para PROCESSANDO)
   */
  public async processarRegistroDadoBruto(
    dadoBrutoId: string,
    usuarioIdEsperado?: string
  ): Promise<ProcessamentoItemResultado> {
    const inicio = Date.now();

    // 1. Busca e bloqueio atômico com transição de status para PROCESSANDO
    // Usa transação Prisma para evitar condição de corrida entre múltiplos workers
    const registro = await prisma.$transaction(async (tx) => {
      const dbItem = await tx.dadoBrutoOpenFinance.findUnique({
        where: { id: dadoBrutoId },
        include: {
          conexao: true,
        },
      });

      if (!dbItem) {
        throw new Error(`Dado bruto [${dadoBrutoId}] não encontrado.`);
      }

      // Validação estrita de isolamento multi-tenant
      if (usuarioIdEsperado && dbItem.usuarioId !== usuarioIdEsperado) {
        throw new Error(
          `Violação de isolamento multi-tenant: registro [${dadoBrutoId}] pertence ao usuário ${dbItem.usuarioId}, não a ${usuarioIdEsperado}.`
        );
      }

      // Se já estiver PROCESSADO, não reprocessa
      if (dbItem.status === 'PROCESSADO') {
        return null;
      }

      // Se já estiver em PROCESSANDO por outro worker recentemente (menos de 2 min), pula
      if (dbItem.status === 'PROCESSANDO') {
        const diffMs = Date.now() - (dbItem.processadoEm ? dbItem.processadoEm.getTime() : 0);
        if (diffMs < 2 * 60 * 1000) {
          return null;
        }
      }

      // Atualiza status para PROCESSANDO
      return await tx.dadoBrutoOpenFinance.update({
        where: { id: dadoBrutoId },
        data: {
          status: 'PROCESSANDO',
          processadoEm: new Date(),
        },
        include: {
          conexao: true,
        },
      });
    });

    if (!registro) {
      // Já processado ou sob processamento concorrente ativo
      return {
        dadoBrutoId,
        tipoDado: 'IGNORADO',
        sucesso: true,
        novosMovimentosInseridos: 0,
        duplicadasIgnoradas: 0,
        pagamentosFaturaConvertidos: 0,
        tentativas: 0,
        enviadoParaDLQ: false,
      };
    }

    const { usuarioId, conexaoId, instituicaoCodigo, tipoDado, payloadRaw } = registro;

    try {
      let novosMovimentosInseridos = 0;
      let duplicadasIgnoradas = 0;
      let pagamentosFaturaConvertidos = 0;

      // 2. Executa a conciliação e ETL de acordo com o tipo de dado bruto
      if (tipoDado === 'CONTAS') {
        const contas = (Array.isArray(payloadRaw) ? payloadRaw : (payloadRaw as any)?.contas || []) as BankAccountRaw[];
        await this.sincronizarContasUsuario(usuarioId, conexaoId, instituicaoCodigo, contas);
      } else if (tipoDado === 'TRANSACOES') {
        const payload = payloadRaw as any;
        if (!payload || !Array.isArray(payload.transacoes)) {
          throw new Error('Payload bruto de TRANSACOES inválido: array de transações não encontrado.');
        }

        const contaIdExterno = payload.contaIdExterno;
        const contaNome = payload.contaNome || `Conta ${instituicaoCodigo}`;
        const tipoConta = payload.tipoConta || 'CONTA_CORRENTE';
        const transacoes = payload.transacoes as BankTransactionRaw[];

        // Obter ou provisionar conta local
        const contaLocal = await this.obterOuCriarContaLocal(usuarioId, contaNome, tipoConta);

        // Processar transações via NormalizationPipelineService
        const resPipeline = await this.pipeline.processAndIngest(usuarioId, {
          contaId: contaLocal.id,
          transacoes,
          origemDocumento: `OF_WORKER_${instituicaoCodigo}`,
        });

        novosMovimentosInseridos += resPipeline.novosInseridos;
        duplicadasIgnoradas += resPipeline.duplicadasIgnoradas;
        pagamentosFaturaConvertidos += resPipeline.pagamentosFaturaConvertidos;
      } else if (tipoDado === 'FATURAS') {
        const payload = payloadRaw as any;
        if (!payload || !Array.isArray(payload.faturas)) {
          throw new Error('Payload bruto de FATURAS inválido: array de faturas não encontrado.');
        }

        const cartaoIdExterno = payload.cartaoIdExterno;
        const faturas = payload.faturas as BankInvoiceRaw[];

        for (const fatura of faturas) {
          const nomeContaCartao = fatura.cartaoNome || `Cartão ${instituicaoCodigo}`;
          const contaCartao = await this.obterOuCriarContaLocal(usuarioId, nomeContaCartao, 'CARTAO_CREDITO');

          if (fatura.lancamentos && fatura.lancamentos.length > 0) {
            const resPipeline = await this.pipeline.processAndIngest(usuarioId, {
              contaId: contaCartao.id,
              transacoes: fatura.lancamentos,
              origemDocumento: `OF_FATURA_${instituicaoCodigo}_${fatura.competencia}`,
            });

            novosMovimentosInseridos += resPipeline.novosInseridos;
            duplicadasIgnoradas += resPipeline.duplicadasIgnoradas;
            pagamentosFaturaConvertidos += resPipeline.pagamentosFaturaConvertidos;
          }
        }
      }

      // 3. Atualizar status para PROCESSADO com sucesso
      const processadoEm = new Date();
      await prisma.dadoBrutoOpenFinance.update({
        where: { id: dadoBrutoId },
        data: {
          status: 'PROCESSADO',
          processadoEm,
          mensagemErro: null,
        },
      });

      const duracaoMs = Date.now() - inicio;

      // 4. Emitir evento de sucesso para notificar UI e ouvintes em tempo real
      openFinanceEventBus.emitProcessedSuccess({
        usuarioId,
        conexaoId,
        instituicaoCodigo,
        dadosBrutosId: dadoBrutoId,
        tipoDado,
        novosMovimentosInseridos,
        duplicadasIgnoradas,
        pagamentosFaturaConvertidos,
        processadoEm,
        duracaoMs,
      });

      return {
        dadoBrutoId,
        tipoDado,
        sucesso: true,
        novosMovimentosInseridos,
        duplicadasIgnoradas,
        pagamentosFaturaConvertidos,
        tentativas: registro.tentativas,
        enviadoParaDLQ: false,
      };
    } catch (err: unknown) {
      const mensagemErro = err instanceof Error ? err.message : String(err);
      const novasTentativas = registro.tentativas + 1;
      const enviadoParaDLQ = novasTentativas >= this.maxRetries;
      const statusFinal = enviadoParaDLQ ? 'ERRO_PROCESSAMENTO' : 'PENDENTE_PROCESSAMENTO';

      // Atualiza com erro e incrementa tentativas
      await prisma.dadoBrutoOpenFinance.update({
        where: { id: dadoBrutoId },
        data: {
          status: statusFinal,
          tentativas: novasTentativas,
          mensagemErro,
          processadoEm: new Date(),
        },
      });

      // Emite evento de falha / DLQ
      openFinanceEventBus.emitProcessedError({
        usuarioId,
        conexaoId,
        dadosBrutosId: dadoBrutoId,
        tipoDado,
        erro: mensagemErro,
        tentativas: novasTentativas,
        enviadoParaDLQ,
        timestamp: new Date(),
      });

      return {
        dadoBrutoId,
        tipoDado,
        sucesso: false,
        novosMovimentosInseridos: 0,
        duplicadasIgnoradas: 0,
        pagamentosFaturaConvertidos: 0,
        erro: mensagemErro,
        tentativas: novasTentativas,
        enviadoParaDLQ,
      };
    }
  }

  /**
   * Executa varredura (Sweep) de registros pendentes ou falhos para recuperação automática
   */
  public async executarSweepSeguranca(limiteLote: number = 50): Promise<SweepProcessamentoResultado> {
    if (this.isProcessingSweep) {
      return {
        totalPendentesEncontrados: 0,
        processadosSucesso: 0,
        processadosComErro: 0,
        itens: [],
        duracaoMs: 0,
      };
    }

    this.isProcessingSweep = true;
    const inicio = Date.now();

    try {
      // Busca itens PENDENTE_PROCESSAMENTO ou travados em PROCESSANDO há mais de 10 minutos
      const limiteStale = new Date(Date.now() - 10 * 60 * 1000);

      const itensPendentes = await prisma.dadoBrutoOpenFinance.findMany({
        where: {
          OR: [
            {
              status: 'PENDENTE_PROCESSAMENTO',
              tentativas: { lt: this.maxRetries },
            },
            {
              status: 'PROCESSANDO',
              processadoEm: { lt: limiteStale },
              tentativas: { lt: this.maxRetries },
            },
          ],
        },
        orderBy: { coletadoEm: 'asc' },
        take: limiteLote,
        select: {
          id: true,
          usuarioId: true,
        },
      });

      const itensResultados: ProcessamentoItemResultado[] = [];
      let totalSucesso = 0;
      let totalErro = 0;

      for (const item of itensPendentes) {
        const res = await this.processarRegistroDadoBruto(item.id, item.usuarioId);
        itensResultados.push(res);
        if (res.sucesso) {
          totalSucesso++;
        } else {
          totalErro++;
        }
      }

      return {
        totalPendentesEncontrados: itensPendentes.length,
        processadosSucesso: totalSucesso,
        processadosComErro: totalErro,
        itens: itensResultados,
        duracaoMs: Date.now() - inicio,
      };
    } finally {
      this.isProcessingSweep = false;
    }
  }

  /**
   * Reprocessa registros que caíram na Dead Letter Queue (DLQ / ERRO_PROCESSAMENTO)
   */
  public async reprocessarDLQ(dadoBrutoId?: string, usuarioId?: string): Promise<ProcessamentoItemResultado[]> {
    const itensDLQ = await prisma.dadoBrutoOpenFinance.findMany({
      where: {
        status: 'ERRO_PROCESSAMENTO',
        ...(dadoBrutoId ? { id: dadoBrutoId } : {}),
        ...(usuarioId ? { usuarioId } : {}),
      },
      take: 50,
      select: {
        id: true,
        usuarioId: true,
      },
    });

    const resultados: ProcessamentoItemResultado[] = [];

    for (const item of itensDLQ) {
      // Reseta tentativas e status para reexecutar
      await prisma.dadoBrutoOpenFinance.update({
        where: { id: item.id },
        data: {
          status: 'PENDENTE_PROCESSAMENTO',
          tentativas: 0,
          mensagemErro: null,
        },
      });

      const res = await this.processarRegistroDadoBruto(item.id, item.usuarioId);
      resultados.push(res);
    }

    return resultados;
  }

  /**
   * Sincroniza contas bancárias a partir do payload de contas brutas
   */
  private async sincronizarContasUsuario(
    usuarioId: string,
    conexaoId: string,
    instituicaoCodigo: string,
    contas: BankAccountRaw[]
  ): Promise<void> {
    for (const rawAcc of contas) {
      await this.obterOuCriarContaLocal(usuarioId, rawAcc.nome, rawAcc.tipo, {
        saldoInicial: rawAcc.saldoAtual,
        diaFechamento: rawAcc.diaFechamento,
        diaVencimento: rawAcc.diaVencimento,
      });
    }
  }

  /**
   * Obtém ou provisiona uma conta local para o usuário com isolamento garantido
   */
  private async obterOuCriarContaLocal(
    usuarioId: string,
    nome: string,
    tipo: 'CONTA_CORRENTE' | 'CARTAO_CREDITO' | 'INVESTIMENTO' | 'CARTEIRA_DINHEIRO',
    dadosAdicionais?: {
      saldoInicial?: number;
      diaFechamento?: number;
      diaVencimento?: number;
    }
  ) {
    let conta = await prisma.conta.findFirst({
      where: {
        usuarioId,
        nome,
      },
    });

    if (!conta) {
      conta = await prisma.conta.create({
        data: {
          usuarioId,
          nome,
          tipo,
          saldoInicial: dadosAdicionais?.saldoInicial ?? 0,
          diaFechamento: dadosAdicionais?.diaFechamento ?? null,
          diaVencimento: dadosAdicionais?.diaVencimento ?? null,
        },
      });
    }

    return conta;
  }
}

export const openFinanceWorkerService = new OpenFinanceWorkerService();
