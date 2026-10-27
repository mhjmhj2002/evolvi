import { z } from 'zod';

export const criarRegraExclusaoMediaSchema = z.object({
  categoriaId: z.string().uuid().optional().nullable(),
  descricaoPadrao: z.string().max(255).optional().nullable(),
  valorMinimo: z.number().positive().optional().nullable(),
  apenasUmaVez: z.boolean().default(false),
  ativo: z.boolean().default(true),
  motivo: z.string().max(255).optional().nullable(),
});

export const atualizarRegraExclusaoMediaSchema = z.object({
  categoriaId: z.string().uuid().optional().nullable(),
  descricaoPadrao: z.string().max(255).optional().nullable(),
  valorMinimo: z.number().positive().optional().nullable(),
  apenasUmaVez: z.boolean().optional(),
  ativo: z.boolean().optional(),
  motivo: z.string().max(255).optional().nullable(),
});

export const criarExclusaoManualSchema = z.object({
  movimentoId: z.string().uuid(),
  motivo: z.string().min(1).max(255),
});

export const queryPesquisaLancamentosSchema = z.object({
  termo: z.string().optional(),
  competencia: z.string().regex(/^\d{4}-\d{2}$/, 'Formato deve ser YYYY-MM').optional(),
  categoriaId: z.string().uuid().optional(),
  apenasExcluidos: z.coerce.boolean().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

export const queryMediaMensalConsolidadaSchema = z.object({
  competenciaReferencia: z.string().regex(/^\d{4}-\d{2}$/, 'Formato deve ser YYYY-MM').optional(),
  mesesJanela: z.coerce.number().int().min(3).max(12).optional(),
});
