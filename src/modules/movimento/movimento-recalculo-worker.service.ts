import { authEventBus, AuthEventBus, UsuarioAutenticadoEvent } from '../../infrastructure/events/auth-event-bus.js';
import { MovimentoRecalculoService, RecalculoMovimentosResultado } from './movimento-recalculo.service.js';

export class MovimentoRecalculoWorkerService {
  private isListeningEvents: boolean = false;
  private boundListener?: (event: UsuarioAutenticadoEvent) => void;
  // Mutex / lock para evitar múltiplas execuções simultâneas para o mesmo usuário
  private processamentosAtivos: Set<string> = new Set();

  constructor(autoListen: boolean = false) {
    if (autoListen) {
      this.setupEventListener();
    }
  }

  /**
   * Configura o ouvinte orientado a eventos para desacoplar totalmente o login
   */
  public setupEventListener(): void {
    if (this.isListeningEvents) {
      return;
    }

    this.boundListener = (event: UsuarioAutenticadoEvent) => {
      // Dispara o processamento em background (fire-and-forget), sem bloquear o emissor
      this.processarParaUsuario(event.usuarioId).catch((err) => {
        console.error(
          `[MovimentoRecalculoWorker] Erro ao recalcular movimentos para o usuário [${event.usuarioId}]:`,
          err
        );
      });
    };

    authEventBus.onUsuarioAutenticado(this.boundListener);
    this.isListeningEvents = true;
  }

  public removeEventListener(): void {
    if (this.boundListener) {
      authEventBus.removeListener(AuthEventBus.EVENT_USUARIO_AUTENTICADO, this.boundListener);
      this.boundListener = undefined;
    }
    this.isListeningEvents = false;
  }

  /**
   * Executa o recálculo em segundo plano garantindo isolamento e evitando concorrência no mesmo usuário
   */
  public async processarParaUsuario(usuarioId: string): Promise<RecalculoMovimentosResultado | null> {
    if (this.processamentosAtivos.has(usuarioId)) {
      return null;
    }

    this.processamentosAtivos.add(usuarioId);
    try {
      return await MovimentoRecalculoService.verificarERecalcularSeNecessario(usuarioId);
    } finally {
      this.processamentosAtivos.delete(usuarioId);
    }
  }
}

export const movimentoRecalculoWorkerService = new MovimentoRecalculoWorkerService();
