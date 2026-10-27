import { authEventBus, AuthEventBus, UsuarioAutenticadoEvent } from '../../infrastructure/events/auth-event-bus.js';
import {
  importacaoEventBus,
  ImportacaoEventBus,
  ImportacaoLoteConcluidoEvent,
  ImportacaoArquivoConsolidadoFinalEvent,
} from '../../infrastructure/events/importacao-event-bus.js';
import { MovimentoRecalculoService, RecalculoMovimentosResultado } from './movimento-recalculo.service.js';

export class MovimentoRecalculoWorkerService {
  private isListeningEvents: boolean = false;
  private boundAuthListener?: (event: UsuarioAutenticadoEvent) => void;
  private boundLoteListener?: (event: ImportacaoLoteConcluidoEvent) => void;
  private boundArquivoListener?: (event: ImportacaoArquivoConsolidadoFinalEvent) => void;
  // Mutex / lock para evitar múltiplas execuções simultâneas para o mesmo usuário
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
   * 3. Ao Finalizar o Processo de Carregamento/Consolidação com IA (Lote Concluído)
   */
  public setupEventListener(): void {
    if (this.isListeningEvents) {
      return;
    }

    console.log('[evolvi-worker:recalculo] Inicializando ouvinte de eventos de recálculo e saneamento...');

    // Gatilho 1: Login do Usuário
    this.boundAuthListener = (event: UsuarioAutenticadoEvent) => {
      console.log(`[evolvi-worker:recalculo] Usuário [${event.usuarioId}] autenticado. Disparando validação e recálculo...`);
      // Dispara o processamento forçando verificação completa no login (true)
      this.processarParaUsuario(event.usuarioId, true).catch((err) => {
        console.error(
          `[evolvi-worker:recalculo] Erro ao recalcular movimentos para o usuário [${event.usuarioId}]:`,
          err
        );
      });
    };

    // Gatilho 2: Conclusão de Arquivo Individual IA
    this.boundArquivoListener = (event: ImportacaoArquivoConsolidadoFinalEvent) => {
      console.log(
        `[evolvi-worker:recalculo] Arquivo [${event.nomeArquivo}] consolidado. Disparando validação para o usuário [${event.usuarioId}]...`
      );
      this.processarParaUsuario(event.usuarioId, true).catch((err) => {
        console.error(
          `[evolvi-worker:recalculo] Erro ao recalcular movimentos do arquivo [${event.nomeArquivo}] para usuário [${event.usuarioId}]:`,
          err
        );
      });
    };

    // Gatilho 3: Conclusão de Lote de Importação IA
    this.boundLoteListener = (event: ImportacaoLoteConcluidoEvent) => {
      console.log(
        `[evolvi-worker:recalculo] Lote [${event.loteId}] concluído. Disparando validação final para o usuário [${event.usuarioId}]...`
      );
      this.processarParaUsuario(event.usuarioId, true).catch((err) => {
        console.error(
          `[evolvi-worker:recalculo] Erro ao recalcular movimentos do lote [${event.loteId}] para usuário [${event.usuarioId}]:`,
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
   * Executa o recálculo em segundo plano garantindo isolamento e evitando concorrência no mesmo usuário
   */
  public async processarParaUsuario(
    usuarioId: string,
    forcar: boolean = false
  ): Promise<RecalculoMovimentosResultado | null> {
    if (this.processamentosAtivos.has(usuarioId)) {
      console.log(`[evolvi-worker:recalculo] Processamento já ativo para o usuário [${usuarioId}]. Ignorando duplicação.`);
      return null;
    }

    this.processamentosAtivos.add(usuarioId);
    try {
      const inicio = Date.now();
      const resultado = await MovimentoRecalculoService.verificarERecalcularSeNecessario(usuarioId, forcar);
      const duracao = Date.now() - inicio;
      console.log(
        `[evolvi-worker:recalculo] Concluído para [${usuarioId}] em ${duracao}ms (recalculado: ${resultado.recalculado}, avaliados: ${resultado.totalMovimentosAvaliados}, convertidos: ${resultado.totalConvertidosParaReceita})`
      );
      return resultado;
    } finally {
      this.processamentosAtivos.delete(usuarioId);
    }
  }
}

export const movimentoRecalculoWorkerService = new MovimentoRecalculoWorkerService();
