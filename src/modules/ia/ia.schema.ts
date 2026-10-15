import { z } from 'zod';

export const iaParseRequestSchema = z.object({
  texto: z.string().min(1, 'Texto de entrada é obrigatório'),
  modo: z.enum(['CREDITOS', 'API_PROPRIA', 'EXTERNO']).default('CREDITOS'),
  provedor: z.enum(['GEMINI', 'OPENAI', 'ANTHROPIC', 'DEEPSEEK', 'OPENROUTER']).optional(),
  modelo: z.string().optional(),
  apiKey: z.string().optional(),
  dataReferencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data inválido (YYYY-MM-DD)').optional(),
});

export type IaParseRequest = z.infer<typeof iaParseRequestSchema>;

export const iaLancamentoParsedSchema = z.object({
  descricao: z.string(),
  valor: z.number().positive(),
  dataMovimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  natureza: z.enum(['DESPESA', 'RECEITA', 'TRANSFERENCIA_PROPRIA', 'APORTE_PATRIMONIAL']),
  contaId: z.string().nullable().optional(),
  contaNomeSugerida: z.string().nullable().optional(),
  categoriaId: z.string().nullable().optional(),
  categoriaNomeSugerida: z.string().nullable().optional(),
  isPagamentoFatura: z.boolean().default(false),
  parcelasTotal: z.number().int().positive().nullable().optional(),
  parcelaAtual: z.number().int().positive().nullable().optional(),
  observacao: z.string().nullable().optional(),
  confianca: z.number().min(0).max(1).default(0.9),
});

export type IaLancamentoParsed = z.infer<typeof iaLancamentoParsedSchema>;

export const testarApiKeySchema = z.object({
  provedor: z.enum(['GEMINI', 'OPENAI', 'ANTHROPIC', 'DEEPSEEK', 'OPENROUTER']),
  apiKey: z.string().min(8, 'API Key muito curta'),
  modelo: z.string().optional(),
});

export type TestarApiKeyInput = z.infer<typeof testarApiKeySchema>;

export const salvarConfiguracaoIaSchema = z.object({
  provedor: z.enum(['GEMINI', 'OPENAI', 'ANTHROPIC', 'DEEPSEEK', 'OPENROUTER']),
  apiKey: z.string().min(8, 'API Key muito curta'),
  modelo: z.string().optional(),
});

export type SalvarConfiguracaoIaInput = z.infer<typeof salvarConfiguracaoIaSchema>;

export const removerConfiguracaoIaSchema = z.object({
  provedor: z.enum(['GEMINI', 'OPENAI', 'ANTHROPIC', 'DEEPSEEK', 'OPENROUTER']).optional(),
});

export type RemoverConfiguracaoIaInput = z.infer<typeof removerConfiguracaoIaSchema>;

