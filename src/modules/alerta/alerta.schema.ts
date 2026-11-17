import { z } from 'zod';

export const severidadeAlertaSchema = z.enum(['INFO', 'ATENCAO', 'URGENTE']);
export type SeveridadeAlertaInput = z.infer<typeof severidadeAlertaSchema>;

export const statusAlertaSistemaSchema = z.enum(['PENDENTE', 'VISUALIZADO', 'CANCELADO', 'RESOLVIDO']);
export type StatusAlertaSistemaInput = z.infer<typeof statusAlertaSistemaSchema>;

// Schema de Regras de Alerta
export const criarRegraAlertaSchema = z.object({
  codigo: z
    .string()
    .min(1, 'Código é obrigatório')
    .max(60)
    .regex(/^[A-Z0-9_]+$/, 'Código deve estar em maiúsculas sem espaços (ex: VENCIMENTO_CONTAS)'),
  nome: z.string().min(1, 'Nome é obrigatório').max(120),
  descricao: z.string().optional().nullable(),
  tipoGatilho: z.string().max(40).optional().default('CRON_AGENDADO'),
  severidadePadrao: severidadeAlertaSchema.optional().default('INFO'),
  ativo: z.boolean().optional().default(true),
  parametros: z.record(z.string(), z.any()).optional().default({}),
  templateTitulo: z.string().max(200).optional().nullable(),
  templateMensagem: z.string().optional().nullable(),
});
export type CriarRegraAlertaInput = z.infer<typeof criarRegraAlertaSchema>;

export const atualizarRegraAlertaSchema = z.object({
  nome: z.string().min(1).max(120).optional(),
  descricao: z.string().optional().nullable(),
  tipoGatilho: z.string().max(40).optional(),
  severidadePadrao: severidadeAlertaSchema.optional(),
  ativo: z.boolean().optional(),
  parametros: z.record(z.string(), z.any()).optional(),
  templateTitulo: z.string().max(200).optional().nullable(),
  templateMensagem: z.string().optional().nullable(),
});
export type AtualizarRegraAlertaInput = z.infer<typeof atualizarRegraAlertaSchema>;

// Schema de Alerta Sistema Gerado
export const criarAlertaSchema = z.object({
  tipo: z.string().min(1, 'Tipo/Código do alerta é obrigatório').max(60),
  severidade: severidadeAlertaSchema.optional().default('INFO'),
  titulo: z.string().min(1, 'Título é obrigatório').max(200),
  mensagem: z.string().min(1, 'Mensagem é obrigatória'),
  entidadeTipo: z.string().max(50).optional(),
  entidadeId: z.string().uuid().optional(),
  regraAlertaId: z.string().uuid().optional(),
  dataPrevisao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dataExpiracao: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});
export type CriarAlertaInput = z.infer<typeof criarAlertaSchema>;

export const queryAlertasSchema = z.object({
  status: statusAlertaSistemaSchema.optional(),
  tipo: z.string().optional(),
  apenasAtivos: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
});
export type QueryAlertasInput = z.infer<typeof queryAlertasSchema>;

export const atualizarStatusAlertaSchema = z.object({
  status: statusAlertaSistemaSchema,
  motivoCancelamento: z.string().max(100).optional(),
});
export type AtualizarStatusAlertaInput = z.infer<typeof atualizarStatusAlertaSchema>;
