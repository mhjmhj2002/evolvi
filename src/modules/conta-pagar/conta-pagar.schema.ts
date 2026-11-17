import { z } from 'zod';

export const statusContaPagarSchema = z.enum(['PENDENTE', 'AGENDADO', 'PAGO', 'CANCELADO']);
export type StatusContaPagarInput = z.infer<typeof statusContaPagarSchema>;

export const tipoContaPagarSchema = z.enum(['FATURA_CARTAO', 'CONTA_CONSUMO', 'BOLETO', 'OUTRO']);
export type TipoContaPagarInput = z.infer<typeof tipoContaPagarSchema>;

export const criarContaPagarSchema = z.object({
  descricao: z.string().min(1, 'Descrição é obrigatória').max(150),
  valor: z.number().positive('Valor deve ser maior que zero').nullable().optional(),
  valorVariavel: z.boolean().optional().default(false),
  tipoContaPagar: tipoContaPagarSchema.optional().default('OUTRO'),
  diaVencimento: z.number().int().min(1, 'Dia de vencimento deve ser entre 1 e 31').max(31, 'Dia de vencimento deve ser entre 1 e 31'),
  dataVencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de vencimento deve estar no formato YYYY-MM-DD').optional(),
  status: statusContaPagarSchema.optional().default('PENDENTE'),
  categoriaId: z.string().uuid().nullable().optional(),
  contaId: z.string().uuid().nullable().optional(),
  recorrenciaId: z.string().uuid().nullable().optional(),
  essencial: z.boolean().optional().default(true),
  codigoBarras: z.string().max(100).nullable().optional(),
  observacoes: z.string().nullable().optional(),
});
export type CriarContaPagarInput = z.infer<typeof criarContaPagarSchema>;

export const atualizarContaPagarSchema = z.object({
  descricao: z.string().min(1).max(150).optional(),
  valor: z.number().positive().nullable().optional(),
  valorVariavel: z.boolean().optional(),
  tipoContaPagar: tipoContaPagarSchema.optional(),
  diaVencimento: z.number().int().min(1).max(31).optional(),
  dataVencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  dataPagamento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: statusContaPagarSchema.optional(),
  categoriaId: z.string().uuid().nullable().optional(),
  contaId: z.string().uuid().nullable().optional(),
  recorrenciaId: z.string().uuid().nullable().optional(),
  essencial: z.boolean().optional(),
  codigoBarras: z.string().max(100).nullable().optional(),
  observacoes: z.string().nullable().optional(),
});
export type AtualizarContaPagarInput = z.infer<typeof atualizarContaPagarSchema>;

export const queryContasPagarSchema = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  status: statusContaPagarSchema.optional(),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type QueryContasPagarInput = z.infer<typeof queryContasPagarSchema>;
