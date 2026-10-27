import { authEventBus, AuthEventBus, UsuarioAutenticadoEvent } from '../../infrastructure/events/auth-event-bus.js';
import {
  importacaoEventBus,
  ImportacaoEventBus,
  ImportacaoLoteConcluidoEvent,
  ImportacaoArquivoConsolidadoFinalEvent,
} from '../../infrastructure/events/importacao-event-bus.js';
import {
  ParcelamentoSincronizacaoService,
  SincronizacaoParcelamentoResultado,
} from './parcelamento-sincronizacao.service.js';

export class ParcelamentoSincronizacaoWorkerService {
  private isListeningEvents: boolean = false;
  private boundAuthListener?: (event: UsuarioAutenticadoEvent) => void;
  private boundLoteListener?: (event: ImportacaoLoteConcluidoEvent) => void;
  private boundArquivoListener?: (event: ImportacaoArquivoConsolidadoFinalEvent) => void;
  // Mutex para evitar execuções concorrentes do mesmo usuário
  private processamentosAtivos: Set<string> = new Set();

  constructor(autoListen: boolean = false) {
    if (autoListen) {
      this.setupEventListener();
    }
  }

  /**
   * Configura os ouvintes orientados a eventos para:
   * 1. No Login do Usuário (Sessão Ativa)
   * 2. A Cada Arquivo Importado com IA Consolidado
   * 3. Ao Finalizar o Processo de Importação (Lote Concluído)
   */
  public setupEventListener(): void {
    if (this.isListeningEvents) {
      return;
    }

    console.log('[evolvi-worker:parcelamentos] Inicializando ouvinte de sincronização de parcelamentos...');

    // Gatilho 1: Login do Usuário
    this.boundAuthListener = (event: UsuarioAutenticadoEvent) => {
      console.log(`[evolvi-worker:parcelamentos] Usuário [${event.usuarioId}] autenticado. Disparando sincronização de parcelamentos...`);
      this.processarParaUsuario(event.usuarioId).catch((err) => {
        console.error(
          `[evolvi-worker:parcelamentos] Erro no saneamento de parcelamentos no login para usuário [${event.usuarioId}]:`,
          err
        );
      });
    };

    // Gatilho 2: Conclusão de Arquivo Individual IA
    this.boundArquivoListener = (event: ImportacaoArquivoConsolidadoFinalEvent) => {
      console.log(
        `[evolvi-worker:parcelamentos] Arquivo [${event.nomeArquivo}] consolidado. Sincronizando parcelamentos para o usuário [${event.usuarioId}]...`
      );
      this.processarParaUsuario(event.usuarioId).catch((err) => {
        console.error(
          `[evolvi-worker:parcelamentos] Erro no saneamento de parcelamentos no arquivo [${event.nomeArquivo}] para usuário [${event.usuarioId}]:`,
          err
        );
      });
    };

    // Gatilho 3: Conclusão de Lote de Importação
    this.boundLoteListener = (event: ImportacaoLoteConcluidoEvent) => {
      console.log(
        `[evolvi-worker:parcelamentos] Lote [${event.loteId}] concluído. Sincronizando parcelamentos finais para o usuário [${event.usuarioId}]...`
      );
      this.processarParaUsuario(event.usuarioId).catch((err) => {
        console.error(
          `[evolvi-worker:parcelamentos] Erro no saneamento de parcelamentos no lote [${event.loteId}] para usuário [${event.usuarioId}]:`,
          err
        );
      });
    };

    authEventBus.onUsuarioAutenticado(this.boundAuthListener);
    importacaoEventBus.onArquivoConsolidadoFinal(this.boundArquivoListener);
    importacaoEventBus.onLoteConcluido(this.boundLoteListener);
    this.isListeningEvents = true;
  }

  public removeEventListener(): void {
    if (this.boundAuthListener) {
      authEventBus.removeListener(AuthEventBus.EVENT_USUARIO_AUTENTICADO, this.boundAuthListener);
      this.boundAuthListener = undefined;
    }
    if (this.boundArquivoListener) {
      importacaoEventBus.removeListener(
        ImportacaoEventBus.EVENT_ARQUIVO_CONSOLIDADO_FINAL,
        this.boundArquivoListener
      );
      this.boundArquivoListener = undefined;
    }
    if (this.boundLoteListener) {
      importacaoEventBus.removeListener(
        ImportacaoEventBus.EVENT_LOTE_CONCLUIDO,
        this.boundLoteListener
      );
      this.boundLoteListener = undefined;
    }
    this.isListeningEvents = false;
  }

  /**
   * Executa o saneamento para o usuário garantindo isolamento e bloqueio de concorrência
   */
  public async processarParaUsuario(
    usuarioId: string,
    competenciaReferencia?: string
  ): Promise<SincronizacaoParcelamentoResultado | null> {
    if (this.processamentosAtivos.has(usuarioId)) {
      console.log(`[evolvi-worker:parcelamentos] Processamento já ativo para o usuário [${usuarioId}]. Ignorando duplicação.`);
      return null;
    }

    this.processamentosAtivos.add(usuarioId);
    try {
      const inicio = Date.now();
      const resultado = await ParcelamentoSincronizacaoService.sincronizarParaUsuario(
        usuarioId,
        competenciaReferencia
      );
      const duracao = Date.now() - inicio;
      console.log(
        `[evolvi-worker:parcelamentos] Concluído para [${usuarioId}] em ${duracao}ms (avaliados: ${resultado.totalAvaliados}, quitados: ${resultado.totalQuitados}, deduplicados: ${resultado.totalDeduplicados})`
      );
      return resultado;
    } finally {
      this.processamentosAtivos.delete(usuarioId);
    }
  }
}

export const parcelamentoSincronizacaoWorkerService = new ParcelamentoSincronizacaoWorkerService();
