import { EventEmitter } from 'events';

export interface UsuarioAutenticadoEvent {
  usuarioId: string;
  email: string;
  timestamp: Date;
}

export class AuthEventBus extends EventEmitter {
  public static readonly EVENT_USUARIO_AUTENTICADO = 'auth:usuario_autenticado';

  public emitUsuarioAutenticado(event: UsuarioAutenticadoEvent): boolean {
    return this.emit(AuthEventBus.EVENT_USUARIO_AUTENTICADO, event);
  }

  public onUsuarioAutenticado(listener: (event: UsuarioAutenticadoEvent) => void): this {
    return this.on(AuthEventBus.EVENT_USUARIO_AUTENTICADO, listener);
  }
}

export const authEventBus = new AuthEventBus();
