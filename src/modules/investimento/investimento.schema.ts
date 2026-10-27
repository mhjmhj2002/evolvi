import { z } from 'zod';

export const createAporteManualSchema = z.object({
  dataAporte: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data do aporte deve estar no formato YYYY-MM-DD' }),
  contaId: z.string().uuid({ message: 'ID da conta de origem deve ser um UUID válido' }),
  descricao: z.string().min(1, { message: 'Descrição / Produto financeiro é obrigatório' }).max(255),
  valor: z.number().positive({ message: 'Valor investido deve ser positivo e maior que zero' }),
  observacao: z.string().max(500).optional().nullable(),
  produtoTipo: z
    .string()
    .max(100)
    .optional()
    .nullable(),
});

export const queryAportesSchema = z.object({
  competencia: z
    .string()
    .regex(/^\d{4}-\d{2}$/, { message: 'Competência deve estar no formato YYYY-MM' })
    .optional(),
  dataInicio: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data de início deve estar no formato YYYY-MM-DD' })
    .optional(),
  dataFim: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data de fim deve estar no formato YYYY-MM-DD' })
    .optional(),
  contaId: z.string().uuid().optional(),
  busca: z.string().max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type CreateAporteManualInput = z.infer<typeof createAporteManualSchema>;
export type QueryAportesInput = z.infer<typeof queryAportesSchema>;
