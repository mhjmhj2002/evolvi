import { z } from 'zod';
import { TipoConta } from '@prisma/client';

export const tipoContaEnum = z.nativeEnum(TipoConta, {
  message: 'Tipo de conta inválido. Opções: CONTA_CORRENTE, CARTAO_CREDITO, INVESTIMENTO, CARTEIRA_DINHEIRO',
});

export const createContaSchema = z.object({
  nome: z.string().min(1, 'Nome da conta é obrigatório').max(100, 'Nome deve ter no máximo 100 caracteres'),
  tipo: tipoContaEnum,
  diaFechamento: z.number().int().min(1).max(31).nullable().optional(),
  diaVencimento: z.number().int().min(1).max(31).nullable().optional(),
  saldoInicial: z.number().default(0.0),
  ativo: z.boolean().optional().default(true),
}).superRefine((data, ctx) => {
  if (data.tipo === TipoConta.CARTAO_CREDITO) {
    if (data.diaFechamento === undefined || data.diaFechamento === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['diaFechamento'],
        message: 'Dia de fechamento é obrigatório para contas do tipo CARTAO_CREDITO',
      });
    }
    if (data.diaVencimento === undefined || data.diaVencimento === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['diaVencimento'],
        message: 'Dia de vencimento é obrigatório para contas do tipo CARTAO_CREDITO',
      });
    }
  }
});

export const updateContaSchema = z.object({
  nome: z.string().min(1, 'Nome não pode ser vazio').max(100).optional(),
  tipo: tipoContaEnum.optional(),
  diaFechamento: z.number().int().min(1).max(31).nullable().optional(),
  diaVencimento: z.number().int().min(1).max(31).nullable().optional(),
  saldoInicial: z.number().optional(),
  ativo: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (data.tipo === TipoConta.CARTAO_CREDITO) {
    if (data.diaFechamento === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['diaFechamento'],
        message: 'Dia de fechamento não pode ser nulo para cartão de crédito',
      });
    }
    if (data.diaVencimento === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['diaVencimento'],
        message: 'Dia de vencimento não pode ser nulo para cartão de crédito',
      });
    }
  }
});

export const migrarMovimentosContaSchema = z.object({
  contaDestinoId: z.string().uuid({ message: 'ID da conta de destino deve ser um UUID válido' }),
});

export type CreateContaDTO = z.infer<typeof createContaSchema>;
export type UpdateContaDTO = z.infer<typeof updateContaSchema>;
export type MigrarMovimentosContaDTO = z.infer<typeof migrarMovimentosContaSchema>;
