import { z } from 'zod';

export const queryLotesImportacaoSchema = z.object({
  status: z
    .enum([
      'RECEPCIONADO',
      'PROCESSANDO_IA',
      'CARGA_STAGING',
      'CONSOLIDANDO',
      'CONCLUIDO',
      'ERRO_PARCIAL',
      'ERRO_TOTAL',
    ])
    .optional(),
  limite: z.coerce.number().min(1).max(50).default(20),
});

export const loteIdParamSchema = z.object({
  id: z.string().uuid({ message: 'ID do lote deve ser um UUID válido' }),
});

export type QueryLotesImportacaoInput = z.infer<typeof queryLotesImportacaoSchema>;
export type LoteIdParamInput = z.infer<typeof loteIdParamSchema>;
