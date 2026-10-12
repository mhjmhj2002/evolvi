import { prisma } from '../../infrastructure/database/prisma.js';

export const CONFIG_JANELA_MIN = 3;
export const CONFIG_JANELA_MAX = 12;
export const CONFIG_JANELA_DEFAULT = 6;

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
   * Obtém as configurações completas do usuário com limites operacionais
   */
  async obterConfiguracao(usuarioId: string) {
    const mesesJanelaTemporal = await this.obterMesesJanelaUsuario(usuarioId);

    return {
      mesesJanelaTemporal,
      limites: {
        minimo: CONFIG_JANELA_MIN,
        maximo: CONFIG_JANELA_MAX,
        padrao: CONFIG_JANELA_DEFAULT,
      },
    };
  }

  /**
   * Atualiza ou cria a configuração de janela temporal do usuário
   */
  async atualizarConfiguracao(usuarioId: string, mesesJanelaTemporal: number) {
    if (mesesJanelaTemporal < CONFIG_JANELA_MIN || mesesJanelaTemporal > CONFIG_JANELA_MAX) {
      throw new Error(`A janela temporal deve estar entre ${CONFIG_JANELA_MIN} e ${CONFIG_JANELA_MAX} meses.`);
    }

    const config = await prisma.configuracaoUsuario.upsert({
      where: { usuarioId },
      create: {
        usuarioId,
        mesesJanelaTemporal,
      },
      update: {
        mesesJanelaTemporal,
      },
      select: {
        mesesJanelaTemporal: true,
        atualizadoEm: true,
      },
    });

    return {
      mesesJanelaTemporal: config.mesesJanelaTemporal,
      limites: {
        minimo: CONFIG_JANELA_MIN,
        maximo: CONFIG_JANELA_MAX,
        padrao: CONFIG_JANELA_DEFAULT,
      },
      atualizadoEm: config.atualizadoEm,
    };
  }
}

export const configuracaoService = new ConfiguracaoService();
