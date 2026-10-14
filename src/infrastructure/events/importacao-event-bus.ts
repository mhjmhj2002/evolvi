import { EventEmitter } from 'events';

export interface ImportacaoLoteRecepcionadoEvent {
  loteId: string;
  usuarioId: string;
  totalArquivos: number;
  caminhoDiretorio: string;
  recepcionadoEm: Date;
}

export interface ImportacaoArquivoProgressoEvent {
  loteId: string;
  arquivoId: string;
  nomeArquivo: string;
  status: string;
  mensagem?: string;
  timestamp: Date;
}

export interface ImportacaoArquivoConsolidadoProntoEvent {
  loteId: string;
  arquivoId: string;
  usuarioId: string;
  nomeArquivo: string;
  caminhoConsolidado: string;
  totalTransacoes: number;
  timestamp: Date;
}

export interface ImportacaoArquivoStagingCarregadoEvent {
  loteId: string;
  arquivoId: string;
  usuarioId: string;
  nomeArquivo: string;
  totalLinhasStaging: number;
  timestamp: Date;
}

export interface ImportacaoTransacaoConsolidadaEvent {
  loteId: string;
  arquivoId: string;
  arquivoOrigem: string;
  usuarioId: string;
  stagingId: string;
  movimentoId: string;
  dataMovimento: string;
  descricao: string;
  valor: number;
  natureza: string;
  contaNome: string;
  categoriaNome?: string;
  duplicadaIgnorada?: boolean;
  pagamentoFaturaConvertido?: boolean;
  timestamp: Date;
}

export interface ImportacaoLoteConcluidoEvent {
  loteId: string;
  usuarioId: string;
  totalArquivos: number;
  totalTransacoesImportadas: number;
  totalDuplicadasIgnoradas: number;
  totalContasCriadas: number;
  timestamp: Date;
}

export class ImportacaoEventBus extends EventEmitter {
  public static readonly EVENT_LOTE_RECEPCIONADO = 'importacao:lote_recepcionado';
  public static readonly EVENT_ARQUIVO_PROGRESSO = 'importacao:arquivo_progresso';
  public static readonly EVENT_ARQUIVO_CONSOLIDADO_PRONTO = 'importacao:arquivo_consolidado_pronto';
  public static readonly EVENT_ARQUIVO_STAGING_CARREGADO = 'importacao:arquivo_staging_carregado';
  public static readonly EVENT_TRANSACAO_CONSOLIDADA = 'importacao:transacao_consolidada';
  public static readonly EVENT_LOTE_CONCLUIDO = 'importacao:lote_concluido';

  public emitLoteRecepcionado(event: ImportacaoLoteRecepcionadoEvent): boolean {
    return this.emit(ImportacaoEventBus.EVENT_LOTE_RECEPCIONADO, event);
  }

  public onLoteRecepcionado(listener: (event: ImportacaoLoteRecepcionadoEvent) => void): this {
    return this.on(ImportacaoEventBus.EVENT_LOTE_RECEPCIONADO, listener);
  }

  public emitArquivoProgresso(event: ImportacaoArquivoProgressoEvent): boolean {
    return this.emit(ImportacaoEventBus.EVENT_ARQUIVO_PROGRESSO, event);
  }

  public onArquivoProgresso(listener: (event: ImportacaoArquivoProgressoEvent) => void): this {
    return this.on(ImportacaoEventBus.EVENT_ARQUIVO_PROGRESSO, listener);
  }

  public emitArquivoConsolidadoPronto(event: ImportacaoArquivoConsolidadoProntoEvent): boolean {
    return this.emit(ImportacaoEventBus.EVENT_ARQUIVO_CONSOLIDADO_PRONTO, event);
  }

  public onArquivoConsolidadoPronto(
    listener: (event: ImportacaoArquivoConsolidadoProntoEvent) => void
  ): this {
    return this.on(ImportacaoEventBus.EVENT_ARQUIVO_CONSOLIDADO_PRONTO, listener);
  }

  public emitArquivoStagingCarregado(event: ImportacaoArquivoStagingCarregadoEvent): boolean {
    return this.emit(ImportacaoEventBus.EVENT_ARQUIVO_STAGING_CARREGADO, event);
  }

  public onArquivoStagingCarregado(
    listener: (event: ImportacaoArquivoStagingCarregadoEvent) => void
  ): this {
    return this.on(ImportacaoEventBus.EVENT_ARQUIVO_STAGING_CARREGADO, listener);
  }

  public emitTransacaoConsolidada(event: ImportacaoTransacaoConsolidadaEvent): boolean {
    return this.emit(ImportacaoEventBus.EVENT_TRANSACAO_CONSOLIDADA, event);
  }

  public onTransacaoConsolidada(
    listener: (event: ImportacaoTransacaoConsolidadaEvent) => void
  ): this {
    return this.on(ImportacaoEventBus.EVENT_TRANSACAO_CONSOLIDADA, listener);
  }

  public emitLoteConcluido(event: ImportacaoLoteConcluidoEvent): boolean {
    return this.emit(ImportacaoEventBus.EVENT_LOTE_CONCLUIDO, event);
  }

  public onLoteConcluido(listener: (event: ImportacaoLoteConcluidoEvent) => void): this {
    return this.on(ImportacaoEventBus.EVENT_LOTE_CONCLUIDO, listener);
  }
}

export const importacaoEventBus = new ImportacaoEventBus();
