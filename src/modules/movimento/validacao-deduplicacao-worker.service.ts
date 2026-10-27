import { authEventBus, AuthEventBus, UsuarioAutenticadoEvent } from '../../infrastructure/events/auth-event-bus.js';
import {
  importacaoEventBus,
  ImportacaoEventBus,
  ImportacaoLoteConcluidoEvent,
  ImportacaoArquivoConsolidadoFinalEvent,
} from '../../infrastructure/events/importacao-event-bus.js';
import {
  ValidacaoDeduplicacaoService,
  ValidacaoDeduplicacaoResultado,
} from './validacao-deduplicacao.service.js';
import { SuspeitaMovimentoWorkerService } from './suspeita-movimento-worker.service.js';

export class ValidacaoDeduplicacaoWorkerService {
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
   * Configura os ouvintes orientados a eventos para os três gatilhos:
   * 1. No Login do Usuário (Sessão Ativa)
   * 2. A Cada Arquivo Importado com IA Consolidado
   * 3. Ao Final de Cada Lote de Importação
   */
  public setupEventListener(): void {
    if (this.isListeningEvents) {
      return;
    }

    console.log('[evolvi-worker:deduplicacao] Inicializando ouvinte de eventos de validação e deduplicação...');

    // Gatilho 1: Login do Usuário
    this.boundAuthListener = (event: UsuarioAutenticadoEvent) => {
      console.log(`[evolvi-worker:deduplicacao] Usuário [${event.usuarioId}] autenticado. Disparando malha fina e suspeitas...`);
      this.processarParaUsuario(event.usuarioId).catch((err) => {
        console.error(
          `[evolvi-worker:deduplicacao] Erro na malha fina do login para usuário [${event.usuarioId}]:`,
          err
        );
      });
    };

    // Gatilho 2: Conclusão de Arquivo Individual IA
    this.boundArquivoListener = (event: ImportacaoArquivoConsolidadoFinalEvent) => {
      console.log(
        `[evolvi-worker:deduplicacao] Arquivo [${event.nomeArquivo}] consolidado. Disparando malha fina para o usuário [${event.usuarioId}]...`
      );
      this.processarParaUsuario(event.usuarioId).catch((err) => {
        console.error(
          `[evolvi-worker:deduplicacao] Erro na malha fina do arquivo [${event.nomeArquivo}] para usuário [${event.usuarioId}]:`,
          err
        );
      });
    };

    // Gatilho 3: Conclusão de Lote de Importação
    this.boundLoteListener = (event: ImportacaoLoteConcluidoEvent) => {
      console.log(
        `[evolvi-worker:deduplicacao] Lote [${event.loteId}] concluído. Disparando malha fina final para o usuário [${event.usuarioId}]...`
      );
      this.processarParaUsuario(event.usuarioId).catch((err) => {
        console.error(
          `[evolvi-worker:deduplicacao] Erro na malha fina do lote [${event.loteId}] para usuário [${event.usuarioId}]:`,
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
   * Executa a malha fina para o usuário garantindo isolamento e bloqueio de concorrência
   */
  public async processarParaUsuario(
    usuarioId: string,
    opcoes?: { reprocessarTudo?: boolean }
  ): Promise<ValidacaoDeduplicacaoResultado | null> {
    if (this.processamentosAtivos.has(usuarioId)) {
      console.log(`[evolvi-worker:deduplicacao] Processamento já ativo para o usuário [${usuarioId}]. Ignorando duplicação.`);
      return null;
    }

    this.processamentosAtivos.add(usuarioId);
    try {
      const inicio = Date.now();
      const resultado = await ValidacaoDeduplicacaoService.executarMalhaFinaParaUsuario(usuarioId, opcoes);

      // Cataloga e atualiza a tabela suspeitas_movimento em segundo plano
      await SuspeitaMovimentoWorkerService.catalogarSuspeitasParaUsuario(usuarioId).catch((err) => {
        console.error(
          `[evolvi-worker:deduplicacao] Erro ao catalogar suspeitas_movimento para o usuário [${usuarioId}]:`,
          err
        );
      });

      const duracao = Date.now() - inicio;
      console.log(
        `[evolvi-worker:deduplicacao] Concluído para [${usuarioId}] em ${duracao}ms (avaliados: ${resultado.totalAvaliados}, excluídas: ${resultado.totalDuplicatasExcluidas}, marcados: ${resultado.totalValidadosMarcados})`
      );

      return resultado;
    } finally {
      this.processamentosAtivos.delete(usuarioId);
    }
  }
}

export const validacaoDeduplicacaoWorkerService = new ValidacaoDeduplicacaoWorkerService();
