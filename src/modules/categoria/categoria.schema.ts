import { z } from 'zod';

export const createCustomSubcategoriaSchema = z.object({
  nome: z.string().min(1, 'Nome da subcategoria é obrigatório').max(80, 'Nome deve ter no máximo 80 caracteres'),
  categoriaPaiId: z.string().uuid('ID da categoria pai deve ser um UUID válido'),
  descricao: z.string().max(255, 'Descrição deve ter no máximo 255 caracteres').optional(),
});

export type CreateCustomSubcategoriaDTO = z.infer<typeof createCustomSubcategoriaSchema>;
