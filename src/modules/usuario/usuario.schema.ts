import { z } from 'zod';

export const updateConfiguracaoUsuarioSchema = z.object({
  mesesJanelaTemporal: z
    .number({
      required_error: 'mesesJanelaTemporal é obrigatório',
      invalid_type_error: 'mesesJanelaTemporal deve ser um número inteiro',
    })
    .int('mesesJanelaTemporal deve ser um número inteiro')
    .min(3, 'A janela temporal mínima é de 3 meses')
    .max(12, 'A janela temporal máxima é de 12 meses'),
});

export type UpdateConfiguracaoUsuarioInput = z.infer<typeof updateConfiguracaoUsuarioSchema>;

export interface ConfiguracaoUsuarioResponse {
  mesesJanelaTemporal: number;
  limites: {
    minimo: number;
    maximo: number;
    padrao: number;
  };
}
