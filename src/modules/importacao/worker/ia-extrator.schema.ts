import { z } from 'zod';

export const tipoContaIaSchema = z.enum(['CONTA_CORRENTE', 'CARTAO_CREDITO', 'INVESTIMENTO', 'OUTRO']);
export const naturezaIaSchema = z.enum([
  'DESPESA',
  'RECEITA',
  'TRANSFERENCIA_PROPRIA',
  'APORTE_PATRIMONIAL',
]);

export const lancamentoConsolidadoIaSchema = z.object({
  dataMovimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
  descricao: z.string().min(1, 'Descrição não pode ser vazia'),
  valor: z.number().positive('Valor deve ser um número positivo maior que zero'),
  natureza: naturezaIaSchema,
  contaSugerida: z.string().optional().nullable(),
  tipoConta: tipoContaIaSchema.optional().nullable(),
  categoriaSugerida: z.string().optional().nullable(),
  parcelaAtual: z.number().int().positive().optional().nullable(),
  totalParcelas: z.number().int().positive().optional().nullable(),
  isPagamentoFatura: z.boolean().optional().default(false),
  observacao: z.string().optional().nullable(),
  confianca: z.number().min(0).max(1).optional().default(1.0),
});

export const arquivoConsolidadoIaSchema = z.object({
  loteId: z.string().uuid(),
  arquivoId: z.string().uuid(),
  nomeArquivoOrigem: z.string(),
  totalTransacoes: z.number().int().nonnegative(),
  geradoEm: z.string(),
  metadados: z
    .object({
      provedor: z.string(),
      modelo: z.string(),
      tentativas: z.number().default(1),
      formatoDetectado: z.string().optional(),
    })
    .optional(),
  transacoes: z.array(lancamentoConsolidadoIaSchema),
});

export type TipoContaIa = z.infer<typeof tipoContaIaSchema>;
export type NaturezaIa = z.infer<typeof naturezaIaSchema>;
export type LancamentoConsolidadoIa = z.infer<typeof lancamentoConsolidadoIaSchema>;
export type ArquivoConsolidadoIa = z.infer<typeof arquivoConsolidadoIaSchema>;
