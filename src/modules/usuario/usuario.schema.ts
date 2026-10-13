import { z } from 'zod';

export const updateConfiguracaoUsuarioSchema = z.object({
  mesesJanelaTemporal: z
    .number({
      message: 'mesesJanelaTemporal deve ser um número inteiro',
    })
    .int('mesesJanelaTemporal deve ser um número inteiro')
    .min(3, 'A janela temporal mínima é de 3 meses')
    .max(12, 'A janela temporal máxima é de 12 meses')
    .optional(),
  intervaloSincronizacaoHoras: z
    .number({
      message: 'intervaloSincronizacaoHoras deve ser um número inteiro',
    })
    .int('intervaloSincronizacaoHoras deve ser um número inteiro')
    .min(1, 'O intervalo de sincronização mínimo é de 1 hora')
    .max(48, 'O intervalo de sincronização máximo é de 48 horas')
    .optional(),
}).refine(
  (data) => data.mesesJanelaTemporal !== undefined || data.intervaloSincronizacaoHoras !== undefined,
  {
    message: 'Ao menos uma configuração (mesesJanelaTemporal ou intervaloSincronizacaoHoras) deve ser fornecida.',
  }
);

export type UpdateConfiguracaoUsuarioInput = z.infer<typeof updateConfiguracaoUsuarioSchema>;

export interface ConfiguracaoUsuarioResponse {
  mesesJanelaTemporal: number;
  intervaloSincronizacaoHoras: number;
  limites: {
    minimo: number;
    maximo: number;
    padrao: number;
    intervaloSyncMinimo: number;
    intervaloSyncMaximo: number;
    intervaloSyncPadrao: number;
  };
}
