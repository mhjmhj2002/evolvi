import { prisma } from '../../infrastructure/database/prisma.js';

export const CONFIG_JANELA_MIN = 3;
export const CONFIG_JANELA_MAX = 12;
export const CONFIG_JANELA_DEFAULT = 6;

export const CONFIG_INTERVALO_SYNC_MIN = 1;
export const CONFIG_INTERVALO_SYNC_MAX = 48;
export const CONFIG_INTERVALO_SYNC_DEFAULT = 6;

export interface AtualizarConfiguracaoParams {
  mesesJanelaTemporal?: number;
  intervaloSincronizacaoHoras?: number;
}

export class ConfiguracaoService {
  /**
   * Obtém a quantidade de meses da janela temporal configurada para o usuário.
   * Se ainda não configurado ou fora dos limites, retorna o valor padrão 6.
   */
  async obterMesesJanelaUsuario(usuarioId: string): Promise<number> {
    const config = await prisma.configuracaoUsuario.findUnique({
      where: { usuarioId },
      select: { mesesJanelaTemporal: true },
    });

    if (!config || config.mesesJanelaTemporal < CONFIG_JANELA_MIN || config.mesesJanelaTemporal > CONFIG_JANELA_MAX) {
      return CONFIG_JANELA_DEFAULT;
    }

    return config.mesesJanelaTemporal;
  }

  /**
   * Obtém o intervalo de sincronização Open Finance configurado para o usuário (em horas).
   * Se ainda não configurado ou fora dos limites, retorna o valor padrão 6h.
   */
  async obterIntervaloSyncUsuario(usuarioId: string): Promise<number> {
    const config = await prisma.configuracaoUsuario.findUnique({
      where: { usuarioId },
      select: { intervaloSincronizacaoHoras: true },
    });

    if (
      !config ||
      config.intervaloSincronizacaoHoras < CONFIG_INTERVALO_SYNC_MIN ||
      config.intervaloSincronizacaoHoras > CONFIG_INTERVALO_SYNC_MAX
    ) {
      return CONFIG_INTERVALO_SYNC_DEFAULT;
    }

    return config.intervaloSincronizacaoHoras;
  }

  /**
   * Obtém as configurações completas do usuário com limites operacionais
   */
  async obterConfiguracao(usuarioId: string) {
    const mesesJanelaTemporal = await this.obterMesesJanelaUsuario(usuarioId);
    const intervaloSincronizacaoHoras = await this.obterIntervaloSyncUsuario(usuarioId);

    return {
      mesesJanelaTemporal,
      intervaloSincronizacaoHoras,
      limites: {
        minimo: CONFIG_JANELA_MIN,
        maximo: CONFIG_JANELA_MAX,
        padrao: CONFIG_JANELA_DEFAULT,
      },
      limitesSync: {
        minimo: CONFIG_INTERVALO_SYNC_MIN,
        maximo: CONFIG_INTERVALO_SYNC_MAX,
        padrao: CONFIG_INTERVALO_SYNC_DEFAULT,
      },
    };
  }

  /**
   * Atualiza ou cria a configuração de janela temporal e intervalo de sync do usuário.
   * Aceita número (mesesJanelaTemporal) ou objeto { mesesJanelaTemporal?, intervaloSincronizacaoHoras? }
   */
  async atualizarConfiguracao(usuarioId: string, paramsOuMeses: number | AtualizarConfiguracaoParams) {
    let mesesJanelaTemporal: number | undefined;
    let intervaloSincronizacaoHoras: number | undefined;

    if (typeof paramsOuMeses === 'number') {
      mesesJanelaTemporal = paramsOuMeses;
    } else {
      mesesJanelaTemporal = paramsOuMeses.mesesJanelaTemporal;
      intervaloSincronizacaoHoras = paramsOuMeses.intervaloSincronizacaoHoras;
    }

    if (
      mesesJanelaTemporal !== undefined &&
      (mesesJanelaTemporal < CONFIG_JANELA_MIN || mesesJanelaTemporal > CONFIG_JANELA_MAX)
    ) {
      throw new Error(`A janela temporal deve estar entre ${CONFIG_JANELA_MIN} e ${CONFIG_JANELA_MAX} meses.`);
    }

    if (
      intervaloSincronizacaoHoras !== undefined &&
      (intervaloSincronizacaoHoras < CONFIG_INTERVALO_SYNC_MIN ||
        intervaloSincronizacaoHoras > CONFIG_INTERVALO_SYNC_MAX)
    ) {
      throw new Error(
        `O intervalo de sincronização deve estar entre ${CONFIG_INTERVALO_SYNC_MIN} e ${CONFIG_INTERVALO_SYNC_MAX} horas.`
      );
    }

    const config = await prisma.configuracaoUsuario.upsert({
      where: { usuarioId },
      create: {
        usuarioId,
        mesesJanelaTemporal: mesesJanelaTemporal ?? CONFIG_JANELA_DEFAULT,
        intervaloSincronizacaoHoras: intervaloSincronizacaoHoras ?? CONFIG_INTERVALO_SYNC_DEFAULT,
      },
      update: {
        ...(mesesJanelaTemporal !== undefined ? { mesesJanelaTemporal } : {}),
        ...(intervaloSincronizacaoHoras !== undefined ? { intervaloSincronizacaoHoras } : {}),
      },
      select: {
        mesesJanelaTemporal: true,
        intervaloSincronizacaoHoras: true,
        atualizadoEm: true,
      },
    });

    return {
      mesesJanelaTemporal: config.mesesJanelaTemporal,
      intervaloSincronizacaoHoras: config.intervaloSincronizacaoHoras,
      limites: {
        minimo: CONFIG_JANELA_MIN,
        maximo: CONFIG_JANELA_MAX,
        padrao: CONFIG_JANELA_DEFAULT,
      },
      limitesSync: {
        minimo: CONFIG_INTERVALO_SYNC_MIN,
        maximo: CONFIG_INTERVALO_SYNC_MAX,
        padrao: CONFIG_INTERVALO_SYNC_DEFAULT,
      },
      atualizadoEm: config.atualizadoEm,
    };
  }
}

export const configuracaoService = new ConfiguracaoService();
