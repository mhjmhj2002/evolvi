import { z } from 'zod';

export const cadastroSchema = z.object({
  nome: z.string().trim().min(2, 'Nome deve ter pelo menos 2 caracteres').max(120),
  email: z.string().trim().email('E-mail inválido').max(180),
  senha: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres').max(100),
  role: z
    .enum(['OWNER', 'ADMIN', 'USER', 'VISITANTE', 'owner', 'admin', 'user', 'visitante'])
    .optional(),
  rendaBaseMensal: z.number().nonnegative('Renda base não pode ser negativa').optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().email('E-mail inválido'),
  senha: z.string().min(1, 'Senha é obrigatória'),
});

export const updateRendaBaseSchema = z.object({
  rendaBaseMensal: z.number().nonnegative('Renda base não pode ser negativa'),
});

export type CadastroInput = z.infer<typeof cadastroSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateRendaBaseInput = z.infer<typeof updateRendaBaseSchema>;
