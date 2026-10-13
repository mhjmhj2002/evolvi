import { z } from 'zod';

export const createMovimentoSchema = z.object({
  contaId: z.string().uuid({ message: 'ID da conta deve ser um UUID válido' }),
  categoriaId: z.string().uuid({ message: 'ID da categoria deve ser um UUID válido' }).optional().nullable(),
  dataMovimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data do movimento deve estar no formato YYYY-MM-DD' }),
  competencia: z.string().regex(/^\d{4}-\d{2}$/, { message: 'Competência deve estar no formato YYYY-MM' }).optional(),
  descricao: z.string().min(1, { message: 'Descrição é obrigatória' }).max(255),
  valor: z.number().positive({ message: 'Valor deve ser positivo' }),
  natureza: z.enum(['RECEITA', 'DESPESA', 'TRANSFERENCIA_PROPRIA', 'APORTE_PATRIMONIAL'], {
    message: 'Natureza inválida',
  }),
  status: z.enum(['PREVISTO', 'CONCILIADO', 'CANCELADO']).optional().default('CONCILIADO'),
  chaveDedupe: z.string().max(255).optional().nullable(),
  observacao: z.string().optional().nullable(),
  origemDocumento: z.string().max(255).optional().nullable(),
  // Campos específicos para transferência ou pagamento de fatura entre contas
  contaDestinoId: z.string().uuid({ message: 'ID da conta destino deve ser um UUID válido' }).optional().nullable(),
  isPagamentoFatura: z.boolean().optional(),
});

export const updateMovimentoSchema = z.object({
  contaId: z.string().uuid({ message: 'ID da conta deve ser um UUID válido' }).optional(),
  categoriaId: z.string().uuid({ message: 'ID da categoria deve ser um UUID válido' }).optional().nullable(),
  dataMovimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data do movimento deve estar no formato YYYY-MM-DD' }).optional(),
  competencia: z.string().regex(/^\d{4}-\d{2}$/, { message: 'Competência deve estar no formato YYYY-MM' }).optional(),
  descricao: z.string().min(1, { message: 'Descrição não pode ser vazia' }).max(255).optional(),
  valor: z.number().positive({ message: 'Valor deve ser positivo' }).optional(),
  natureza: z.enum(['RECEITA', 'DESPESA', 'TRANSFERENCIA_PROPRIA', 'APORTE_PATRIMONIAL']).optional(),
  status: z.enum(['PREVISTO', 'CONCILIADO', 'CANCELADO']).optional(),
  chaveDedupe: z.string().max(255).optional().nullable(),
  observacao: z.string().optional().nullable(),
  origemDocumento: z.string().max(255).optional().nullable(),
});

export const queryMovimentosSchema = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/, { message: 'Competência deve estar no formato YYYY-MM' }).optional(),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data de início deve estar no formato YYYY-MM-DD' }).optional(),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data de fim deve estar no formato YYYY-MM-DD' }).optional(),
  busca: z.string().max(100).optional(),
  contaId: z.string().uuid().optional(),
  categoriaId: z.string().uuid().optional(),
  natureza: z.enum(['RECEITA', 'DESPESA', 'TRANSFERENCIA_PROPRIA', 'APORTE_PATRIMONIAL']).optional(),
  status: z.enum(['PREVISTO', 'CONCILIADO', 'CANCELADO']).optional(),
});

export const importarMovimentosItemSchema = z.object({
  contaId: z.string().uuid(),
  categoriaId: z.string().uuid().optional().nullable(),
  dataMovimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  competencia: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  descricao: z.string().min(1).max(255),
  valor: z.number().positive(),
  natureza: z.enum(['RECEITA', 'DESPESA', 'TRANSFERENCIA_PROPRIA', 'APORTE_PATRIMONIAL']).default('DESPESA'),
  status: z.enum(['PREVISTO', 'CONCILIADO', 'CANCELADO']).optional().default('CONCILIADO'),
  chaveDedupe: z.string().max(255).optional().nullable(),
  observacao: z.string().optional().nullable(),
  origemDocumento: z.string().max(255).optional().nullable(),
  isPagamentoFatura: z.boolean().optional(),
});

export const importarMovimentosSchema = z.object({
  origemDocumento: z.string().max(255).optional(),
  movimentos: z.array(importarMovimentosItemSchema).min(1, { message: 'Lista de movimentos não pode ser vazia' }),
});

export type CreateMovimentoInput = z.infer<typeof createMovimentoSchema>;
export type UpdateMovimentoInput = z.infer<typeof updateMovimentoSchema>;
export type QueryMovimentosInput = z.infer<typeof queryMovimentosSchema>;
export type ImportarMovimentosInput = z.infer<typeof importarMovimentosSchema>;
