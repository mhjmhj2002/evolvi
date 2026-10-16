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

export const processarLoteIaBodySchema = z.object({
  provedorIa: z.enum(['GEMINI', 'OPENAI', 'ANTHROPIC', 'DEEPSEEK', 'OPENROUTER']).optional(),
  modeloIa: z.string().optional(),
});

export type ProcessarLoteIaBodyInput = z.infer<typeof processarLoteIaBodySchema>;

export const arquivoIdParamSchema = z.object({
  id: z.string().uuid({ message: 'ID do arquivo deve ser um UUID válido' }),
});

export type ArquivoIdParamInput = z.infer<typeof arquivoIdParamSchema>;

export const reprocessarArquivoIaBodySchema = z.object({
  provedorIa: z.enum(['GEMINI', 'OPENAI', 'ANTHROPIC', 'DEEPSEEK', 'OPENROUTER']).optional(),
  modeloIa: z.string().optional(),
});

export type ReprocessarArquivoIaBodyInput = z.infer<typeof reprocessarArquivoIaBodySchema>;

export const queryAlertasConciliacaoSchema = z.object({
  status: z.enum(['PENDENTE', 'RESOLVIDO', 'DISPENSADO']).optional(),
});

export const alertaIdParamSchema = z.object({
  id: z.string().uuid({ message: 'ID do alerta deve ser um UUID válido' }),
});

export const dispensarAlertaBodySchema = z.object({
  motivoDispensa: z.string().min(1, 'Motivo da dispensa é obrigatório'),
});

