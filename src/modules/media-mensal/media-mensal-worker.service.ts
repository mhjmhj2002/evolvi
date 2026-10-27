import { authEventBus, UsuarioAutenticadoEvent } from '../../infrastructure/events/auth-event-bus.js';
import {
  importacaoEventBus,
  ImportacaoLoteConcluidoEvent,
  ImportacaoArquivoConsolidadoFinalEvent,
} from '../../infrastructure/events/importacao-event-bus.js';
import { motorExclusaoMediaService } from './motor-exclusao-media.service.js';

export class MediaMensalWorkerService {
  private isListeningEvents: boolean = false;
  private boundAuthListener?: (event: UsuarioAutenticadoEvent) => void;
  private boundArquivoListener?: (event: ImportacaoArquivoConsolidadoFinalEvent) => void;
  private boundLoteListener?: (event: ImportacaoLoteConcluidoEvent) => void;

  // Mutex para evitar concorrência no recálculo para o mesmo usuário
  private processamentosAtivos: Set<string> = new Set();

  constructor(autoListen: boolean = false) {
    if (autoListen) {
      this.setupEventListener();
    }
  }

  public setupEventListener(): void {
    if (this.isListeningEvents) {
      return;
    }

    console.log('[evolvi-worker:media-mensal] Inicializando ouvinte de eventos de consolidação de médias...');

    // 1. Acionado a cada Login
    this.boundAuthListener = (event: UsuarioAutenticadoEvent) => {
      console.log(`[evolvi-worker:media-mensal] Usuário [${event.usuarioId}] autenticado. Executando consolidação da média...`);
      this.processarParaUsuario(event.usuarioId).catch((err) => {
        console.error(
          `[evolvi-worker:media-mensal] Erro ao consolidar média no login do usuário [${event.usuarioId}]:`,
          err
        );
      });
    };

    // 2. Acionado após arquivo consolidado por IA
    this.boundArquivoListener = (event: ImportacaoArquivoConsolidadoFinalEvent) => {
      console.log(
        `[evolvi-worker:media-mensal] Arquivo [${event.nomeArquivo}] consolidado. Recalculando médias para o usuário [${event.usuarioId}]...`
      );
      this.processarParaUsuario(event.usuarioId).catch((err) => {
        console.error(
          `[evolvi-worker:media-mensal] Erro ao consolidar média pós-arquivo [${event.nomeArquivo}] para usuário [${event.usuarioId}]:`,
          err
        );
      });
    };

    // 3. Acionado ao concluir lote de importação
    this.boundLoteListener = (event: ImportacaoLoteConcluidoEvent) => {
      console.log(
        `[evolvi-worker:media-mensal] Lote [${event.loteId}] concluído. Recalculando consolidação final de médias para o usuário [${event.usuarioId}]...`
      );
      this.processarParaUsuario(event.usuarioId).catch((err) => {
        console.error(
          `[evolvi-worker:media-mensal] Erro ao consolidar média pós-lote [${event.loteId}] para usuário [${event.usuarioId}]:`,
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
      authEventBus.removeListener('auth:usuario_autenticado', this.boundAuthListener);
    }
    if (this.boundArquivoListener) {
      importacaoEventBus.removeListener('importacao:arquivo_consolidado_final', this.boundArquivoListener);
    }
    if (this.boundLoteListener) {
      importacaoEventBus.removeListener('importacao:lote_concluido', this.boundLoteListener);
    }
    this.isListeningEvents = false;
  }

  public async processarParaUsuario(usuarioId: string) {
    if (this.processamentosAtivos.has(usuarioId)) {
      console.log(`[evolvi-worker:media-mensal] Processamento de médias já ativo para o usuário [${usuarioId}]. Aguardando conclusão.`);
      return;
    }

    this.processamentosAtivos.add(usuarioId);
    const inicio = Date.now();

    try {
      const res = await motorExclusaoMediaService.consolidarMedias(usuarioId);
      const tempo = Date.now() - inicio;
      console.log(
        `[evolvi-worker:media-mensal] Média consolidada para [${usuarioId}] em ${tempo}ms. Bruto: R$ ${res.totalPeriodoBruto} | Excluído: R$ ${res.totalExcluido} | Efetivo: R$ ${res.totalPeriodoEfetivo} | Média: R$ ${res.mediaMensalEfetiva}`
      );
      return res;
    } finally {
      this.processamentosAtivos.delete(usuarioId);
    }
  }
}

export const mediaMensalWorkerService = new MediaMensalWorkerService();
