import { EventEmitter } from 'events';

export interface OpenFinanceRawIngestedEvent {
  usuarioId: string;
  conexaoId: string;
  instituicaoCodigo: string;
  loteId: string;
  dadosBrutosIds: string[];
  coletadoEm: Date;
  quantidadeRegistros: number;
}

export interface OpenFinanceSyncErrorEvent {
  usuarioId: string;
  conexaoId: string;
  instituicaoCodigo: string;
  erro: string;
  timestamp: Date;
}

export interface OpenFinanceJobCompletedEvent {
  jobId: string;
  conexoesVerificadas: number;
  conexoesSincronizadas: number;
  erros: number;
  dadosBrutosGerados: number;
  duracaoMs: number;
}

export interface OpenFinanceProcessedEvent {
  usuarioId: string;
  conexaoId: string;
  instituicaoCodigo: string;
  dadosBrutosId: string;
  tipoDado: string;
  novosMovimentosInseridos: number;
  duplicadasIgnoradas: number;
  pagamentosFaturaConvertidos: number;
  processadoEm: Date;
  duracaoMs: number;
}

export interface OpenFinanceProcessedErrorEvent {
  usuarioId: string;
  conexaoId: string;
  dadosBrutosId: string;
  tipoDado?: string;
  erro: string;
  tentativas: number;
  enviadoParaDLQ: boolean;
  timestamp: Date;
}

export class OpenFinanceEventBus extends EventEmitter {
  public static readonly EVENT_RAW_INGESTED = 'open_finance:raw_ingested';
  public static readonly EVENT_SYNC_ERROR = 'open_finance:sync_error';
  public static readonly EVENT_JOB_COMPLETED = 'open_finance:job_completed';
  public static readonly EVENT_PROCESSED_SUCCESS = 'open_finance:processed_success';
  public static readonly EVENT_PROCESSED_ERROR = 'open_finance:processed_error';

  public emitRawIngested(event: OpenFinanceRawIngestedEvent): boolean {
    return this.emit(OpenFinanceEventBus.EVENT_RAW_INGESTED, event);
  }

  public onRawIngested(listener: (event: OpenFinanceRawIngestedEvent) => void): this {
    return this.on(OpenFinanceEventBus.EVENT_RAW_INGESTED, listener);
  }

  public emitSyncError(event: OpenFinanceSyncErrorEvent): boolean {
    return this.emit(OpenFinanceEventBus.EVENT_SYNC_ERROR, event);
  }

  public onSyncError(listener: (event: OpenFinanceSyncErrorEvent) => void): this {
    return this.on(OpenFinanceEventBus.EVENT_SYNC_ERROR, listener);
  }

  public emitJobCompleted(event: OpenFinanceJobCompletedEvent): boolean {
    return this.emit(OpenFinanceEventBus.EVENT_JOB_COMPLETED, event);
  }

  public onJobCompleted(listener: (event: OpenFinanceJobCompletedEvent) => void): this {
    return this.on(OpenFinanceEventBus.EVENT_JOB_COMPLETED, listener);
  }

  public emitProcessedSuccess(event: OpenFinanceProcessedEvent): boolean {
    return this.emit(OpenFinanceEventBus.EVENT_PROCESSED_SUCCESS, event);
  }

  public onProcessedSuccess(listener: (event: OpenFinanceProcessedEvent) => void): this {
    return this.on(OpenFinanceEventBus.EVENT_PROCESSED_SUCCESS, listener);
  }

  public emitProcessedError(event: OpenFinanceProcessedErrorEvent): boolean {
    return this.emit(OpenFinanceEventBus.EVENT_PROCESSED_ERROR, event);
  }

  public onProcessedError(listener: (event: OpenFinanceProcessedErrorEvent) => void): this {
    return this.on(OpenFinanceEventBus.EVENT_PROCESSED_ERROR, listener);
  }
}

export const openFinanceEventBus = new OpenFinanceEventBus();
