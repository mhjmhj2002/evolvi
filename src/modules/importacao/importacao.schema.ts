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

// ---------------------------------------------------------------------------
// TASK-50: Gestão de Importação — Lote → Arquivo → Detalhe
// ---------------------------------------------------------------------------

/** Query do upload: permite forçar reprocessamento de arquivos duplicados. */
export const uploadImportacaoQuerySchema = z.object({
  provedorIa: z.enum(['GEMINI', 'OPENAI', 'ANTHROPIC', 'DEEPSEEK', 'OPENROUTER']).optional(),
  modeloIa: z.string().min(1).max(80).optional(),
  origem: z.enum(['UPLOAD', 'PASTA']).optional(),
  /** Aceita `true`/`1`/`sim` para confirmar o reprocessamento de arquivos duplicados. */
  forcarReprocessamento: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') return ['true', '1', 'sim', 's'].includes(v.trim().toLowerCase());
      return false;
    }),
});

export type UploadImportacaoQueryInput = z.infer<typeof uploadImportacaoQuerySchema>;

/** Query da listagem paginada de tentativas de um arquivo. */
export const queryTentativasArquivoSchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['SUCESSO', 'FALHA', 'DUPLICADO']).optional(),
});

export type QueryTentativasArquivoInput = z.infer<typeof queryTentativasArquivoSchema>;

