import { z } from 'zod';

export const createRecorrenciaSchema = z.object({
  categoriaId: z.string().uuid({ message: 'ID da categoria deve ser um UUID válido' }).optional().nullable(),
  descricao: z.string().min(1, { message: 'Descrição é obrigatória' }).max(150),
  valorReferencia: z.number().positive({ message: 'Valor de referência deve ser positivo' }),
  diaPrevisto: z.number().int().min(1).max(31, { message: 'Dia previsto deve ser entre 1 e 31' }).optional().nullable(),
  formaPagamento: z.string().max(50).optional().nullable(),
  essencial: z.boolean().optional().default(true),
  status: z.enum(['ATIVA', 'PAUSADA', 'CANCELADA']).optional().default('ATIVA'),
});

export const updateRecorrenciaSchema = z.object({
  categoriaId: z.string().uuid({ message: 'ID da categoria deve ser um UUID válido' }).optional().nullable(),
  descricao: z.string().min(1, { message: 'Descrição não pode ser vazia' }).max(150).optional(),
  valorReferencia: z.number().positive({ message: 'Valor de referência deve ser positivo' }).optional(),
  diaPrevisto: z.number().int().min(1).max(31, { message: 'Dia previsto deve ser entre 1 e 31' }).optional().nullable(),
  formaPagamento: z.string().max(50).optional().nullable(),
  essencial: z.boolean().optional(),
  status: z.enum(['ATIVA', 'PAUSADA', 'CANCELADA']).optional(),
});

export const queryRecorrenciaSchema = z.object({
  essencial: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
  status: z.enum(['ATIVA', 'PAUSADA', 'CANCELADA']).optional(),
});

export type CreateRecorrenciaInput = z.infer<typeof createRecorrenciaSchema>;
export type UpdateRecorrenciaInput = z.infer<typeof updateRecorrenciaSchema>;
export type QueryRecorrenciaInput = z.infer<typeof queryRecorrenciaSchema>;
