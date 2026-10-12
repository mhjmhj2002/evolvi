import { z } from 'zod';

export const queryFase1BaselineSchema = z.object({
  competenciaReferencia: z
    .string()
    .regex(/^\d{4}-\d{2}$/, { message: 'Competência de referência deve estar no formato YYYY-MM' })
    .optional(),
  mesesJanela: z.coerce.number().int().min(3).max(12).optional(),
});

export interface BaselineResponse {
  renda_base: number;
  meses_analisados: string[];
  total_periodo: number;
  media_mensal: number;
  gap_zero_a_zero: number;
  pct_excesso_renda: number;
  detalhes_categorias: {
    categoria_id: string;
    nome: string;
    total_periodo: number;
    media_mensal: number;
  }[];
}

export type SemaforoStatusType = 'VERDE' | 'AMARELO' | 'VERMELHO';

export interface CategoriaSemaforoItem {
  categoria_id: string;
  nome: string;
  ordem: number;
  gasto_medio_mensal: number;
  pct_gasto_atual: number;
  referencia_normalizada_pct: number;
  diferenca_pp: number;
  status_semaforo: SemaforoStatusType;
}

export interface SemaforoResponse {
  total_categorias: number;
  renda_base: number;
  media_mensal_total: number;
  meses_analisados: string[];
  categorias: CategoriaSemaforoItem[];
}

// Schemas e tipos para Metas do Zero a Zero (TASK-08)

export const queryFase1MetasSchema = z.object({
  competencia: z
    .string()
    .regex(/^(\d{4}-\d{2}|PLANO_PADRAO)$/, {
      message: 'Competência deve estar no formato YYYY-MM ou ser PLANO_PADRAO',
    })
    .optional(),
});

export const itemMetaZeroAZeroSchema = z.object({
  categoriaId: z.string().uuid({ message: 'categoriaId deve ser um UUID válido' }),
  metaProposta: z
    .number()
    .nonnegative({ message: 'metaProposta não pode ser negativa' }),
  condicaoAcao: z.string().max(1000).optional().nullable(),
});

export const salvarMetasZeroAZeroSchema = z.object({
  competencia: z
    .string()
    .regex(/^(\d{4}-\d{2}|PLANO_PADRAO)$/, {
      message: 'Competência deve estar no formato YYYY-MM ou ser PLANO_PADRAO',
    })
    .optional(),
  metas: z
    .array(itemMetaZeroAZeroSchema)
    .min(1, { message: 'A lista de metas deve conter ao menos um item' }),
});

export const queryFase1MetasExecucaoSchema = z.object({
  competencia: z
    .string()
    .regex(/^\d{4}-\d{2}$/, { message: 'Competência deve estar no formato YYYY-MM' }),
});

export interface MetaItemResponse {
  id?: string;
  categoria_id: string;
  nome_categoria: string;
  ordem: number;
  baseline_mensal: number;
  meta_proposta: number;
  reducao_proposta: number;
  condicao_acao?: string | null;
  status_semaforo: SemaforoStatusType;
}

export interface PlanoMetasResponse {
  competencia: string;
  renda_base: number;
  total_baseline: number;
  total_meta_proposta: number;
  total_reducao_proposta: number;
  gap_pos_meta: number;
  equacionado: boolean;
  metas: MetaItemResponse[];
}

export interface ExecucaoMetaItem {
  categoria_id: string;
  nome_categoria: string;
  ordem: number;
  meta_proposta: number;
  gasto_realizado: number;
  desvio: number; // meta_proposta - gasto_realizado (positivo = sobra/economia, negativo = estouro)
  pct_atingimento: number; // (gasto_realizado / meta_proposta) * 100 se meta > 0
  situacao: 'DENTRO_DA_META' | 'ESTOURO_DE_META';
  condicao_acao?: string | null;
}

export interface ExecucaoMetasResponse {
  competencia: string;
  renda_base: number;
  total_meta: number;
  total_realizado: number;
  desvio_total: number;
  saldo_disponivel_mes: number; // renda_base - total_realizado
  categorias: ExecucaoMetaItem[];
}
