import { z } from 'zod';

export const connectInstitutionSchema = z.object({
  instituicaoCodigo: z.string().min(1, 'Código da instituição é obrigatório'),
  credentials: z.record(z.unknown()).optional(),
});

export const syncConnectionSchema = z.object({
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data início deve ser YYYY-MM-DD').optional(),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data fim deve ser YYYY-MM-DD').optional(),
});

export const parseStatementSchema = z.object({
  content: z.string().min(1, 'Conteúdo do arquivo é obrigatório'),
  filename: z.string().optional(),
});

export const importStatementSchema = z.object({
  contaId: z.string().uuid('ID de conta inválido'),
  content: z.string().min(1, 'Conteúdo do extrato é obrigatório'),
  filename: z.string().optional(),
});
