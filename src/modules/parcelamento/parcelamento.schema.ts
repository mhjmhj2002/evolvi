import { z } from 'zod';

export const createParcelamentoSchema = z.object({
  contaId: z.string().uuid({ message: 'ID da conta deve ser um UUID válido' }).optional().nullable(),
  categoriaId: z.string().uuid({ message: 'ID da categoria deve ser um UUID válido' }).optional().nullable(),
  descricao: z.string().min(1, { message: 'Descrição é obrigatória' }).max(150),
  valorTotal: z.number().positive({ message: 'Valor total deve ser positivo' }),
  parcelaValor: z.number().positive({ message: 'Valor da parcela deve ser positivo' }).optional(),
  parcelaAtual: z.number().int().min(1, { message: 'Parcela atual deve ser no mínimo 1' }),
  totalParcelas: z.number().int().min(1, { message: 'Total de parcelas deve ser no mínimo 1' }),
  primeiroVencimento: z.string().regex(/^\d{4}-\d{2}$/, { message: 'Primeiro vencimento deve estar no formato YYYY-MM' }),
  ultimoVencimento: z.string().regex(/^\d{4}-\d{2}$/, { message: 'Último vencimento deve estar no formato YYYY-MM' }).optional(),
  status: z.enum(['ATIVO', 'QUITADO', 'CANCELADO']).optional().default('ATIVO'),
}).refine((data) => data.parcelaAtual <= data.totalParcelas, {
  message: 'A parcela atual não pode ser maior que o total de parcelas',
  path: ['parcelaAtual'],
});

export const updateParcelamentoSchema = z.object({
  contaId: z.string().uuid({ message: 'ID da conta deve ser um UUID válido' }).optional().nullable(),
  categoriaId: z.string().uuid({ message: 'ID da categoria deve ser um UUID válido' }).optional().nullable(),
  descricao: z.string().min(1, { message: 'Descrição não pode ser vazia' }).max(150).optional(),
  valorTotal: z.number().positive({ message: 'Valor total deve ser positivo' }).optional(),
  parcelaValor: z.number().positive({ message: 'Valor da parcela deve ser positivo' }).optional(),
  parcelaAtual: z.number().int().min(1).optional(),
  totalParcelas: z.number().int().min(1).optional(),
  primeiroVencimento: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  ultimoVencimento: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  status: z.enum(['ATIVO', 'QUITADO', 'CANCELADO']).optional(),
});

export const queryParcelamentoSchema = z.object({
  status: z.enum(['ATIVO', 'QUITADO', 'CANCELADO']).optional(),
  contaId: z.string().uuid().optional(),
});

export type CreateParcelamentoInput = z.infer<typeof createParcelamentoSchema>;
export type UpdateParcelamentoInput = z.infer<typeof updateParcelamentoSchema>;
export type QueryParcelamentoInput = z.infer<typeof queryParcelamentoSchema>;
