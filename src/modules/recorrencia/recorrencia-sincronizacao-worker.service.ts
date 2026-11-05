import { authEventBus, AuthEventBus, UsuarioAutenticadoEvent } from '../../infrastructure/events/auth-event-bus.js';
import {
  importacaoEventBus,
  ImportacaoEventBus,
  ImportacaoLoteConcluidoEvent,
  ImportacaoArquivoConsolidadoFinalEvent,
} from '../../infrastructure/events/importacao-event-bus.js';
import {
  recorrenciaSincronizacaoService,
  SincronizacaoRecorrenciaResultado,
} from './recorrencia-sincronizacao.service.js';

export class RecorrenciaSincronizacaoWorkerService {
  private isListeningEvents: boolean = false;
  private boundAuthListener?: (event: UsuarioAutenticadoEvent) => void;
  private boundLoteListener?: (event: ImportacaoLoteConcluidoEvent) => void;
  private boundArquivoListener?: (event: ImportacaoArquivoConsolidadoFinalEvent) => void;

  // Mutex para evitar concorrência no recálculo para o mesmo usuário
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

    console.log('[evolvi-worker:recorrencias] Inicializando ouvinte de sincronização de compromissos recorrentes...');

    // Gatilho 1: Login do Usuário
    this.boundAuthListener = (event: UsuarioAutenticadoEvent) => {
      console.log(
        `[evolvi-worker:recorrencias] Usuário [${event.usuarioId}] autenticado. Disparando sincronização de recorrências...`
      );
      this.processarParaUsuario(event.usuarioId).catch((err) => {
        console.error(
          `[evolvi-worker:recorrencias] Erro na detecção de recorrências no login para usuário [${event.usuarioId}]:`,
          err
        );
      });
    };

    // Gatilho 2: Conclusão de Arquivo Individual IA
    this.boundArquivoListener = (event: ImportacaoArquivoConsolidadoFinalEvent) => {
      console.log(
        `[evolvi-worker:recorrencias] Arquivo [${event.nomeArquivo}] consolidado. Sincronizando recorrências para o usuário [${event.usuarioId}]...`
      );
      this.processarParaUsuario(event.usuarioId).catch((err) => {
        console.error(
          `[evolvi-worker:recorrencias] Erro na detecção de recorrências no arquivo [${event.nomeArquivo}] para usuário [${event.usuarioId}]:`,
          err
        );
      });
    };

    // Gatilho 3: Conclusão de Lote de Importação
    this.boundLoteListener = (event: ImportacaoLoteConcluidoEvent) => {
      console.log(
        `[evolvi-worker:recorrencias] Lote [${event.loteId}] concluído. Sincronizando recorrências finais para o usuário [${event.usuarioId}]...`
      );
      this.processarParaUsuario(event.usuarioId).catch((err) => {
        console.error(
          `[evolvi-worker:recorrencias] Erro na detecção de recorrências no lote [${event.loteId}] para usuário [${event.usuarioId}]:`,
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
   * Executa a detecção e sincronização garantindo isolamento e mutex por usuário
   */
  public async processarParaUsuario(
    usuarioId: string,
    competenciaReferencia?: string
  ): Promise<SincronizacaoRecorrenciaResultado | null> {
    if (this.processamentosAtivos.has(usuarioId)) {
      console.log(
        `[evolvi-worker:recorrencias] Processamento já ativo para o usuário [${usuarioId}]. Ignorando duplicação.`
      );
      return null;
    }

    this.processamentosAtivos.add(usuarioId);
    try {
      const inicio = Date.now();
      const resultado = await recorrenciaSincronizacaoService.sincronizarParaUsuario(
        usuarioId,
        competenciaReferencia
      );
      const duracao = Date.now() - inicio;
      console.log(
        `[evolvi-worker:recorrencias] Concluído para [${usuarioId}] em ${duracao}ms (avaliados: ${resultado.totalAvaliados}, criados: ${resultado.totalCriados}, ativos: ${resultado.totalAtivos})`
      );
      return resultado;
    } finally {
      this.processamentosAtivos.delete(usuarioId);
    }
  }
}

export const recorrenciaSincronizacaoWorkerService = new RecorrenciaSincronizacaoWorkerService();
