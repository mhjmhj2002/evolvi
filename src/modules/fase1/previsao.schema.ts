import { z } from 'zod';

export const queryFase1PrevisaoSchema = z.object({
  competenciaReferencia: z
    .string()
    .regex(/^\d{4}-\d{2}$/, { message: 'Competência de referência deve estar no formato YYYY-MM' })
    .optional(),
  mesesProjecao: z
    .coerce
    .number()
    .int()
    .min(1)
    .max(24)
    .optional(),
});

export const queryDecomposicaoCategoriasSchema = z.object({
  competencia: z
    .string()
    .regex(/^\d{4}-\d{2}$/, { message: 'Competência deve estar no formato YYYY-MM' }),
});

export const updateVariavelAuditadaSchema = z.object({
  categoriaId: z.string().uuid().optional(),
  categoriaNome: z.string().optional(),
  valor: z.number().nonnegative({ message: 'Valor deve ser positivo ou zero' }),
});

export const updateVariavelAuditadaLoteSchema = z.object({
  ajustes: z.array(updateVariavelAuditadaSchema).min(1),
});

export interface ProjecaoMesItem {
  competencia: string;
  parcelamentos: number;
  recorrentes: number;
  variavelAuditada: number;
  totalProjetado: number;
  rendaBase: number;
  saldoProjetado: number;
  statusSaldo: 'SUPERAVIT' | 'DEFICIT' | 'ZERO_A_ZERO';
  observacao?: string;
}

export interface PrevisaoSeisMesesResponse {
  competenciaReferencia: string;
  rendaBaseMensal: number;
  mesesProjetados: string[];
  totalParcelamentosPeriodo: number;
  totalRecorrentesPeriodo: number;
  totalVariavelPeriodo: number;
  totalGeralProjetadoPeriodo: number;
  saldoAcumuladoPeriodo: number;
  meses: ProjecaoMesItem[];
}

export interface DecomposicaoCategoriaItem {
  categoriaId?: string;
  nome: string;
  ordem?: number;
  recorrentes: number;
  parcelas: number;
  variavelAuditada: number;
  totalProjetado: number;
  percentualDoTotal: number;
  fundamentacao?: string;
}

export interface DecomposicaoCategoriasResponse {
  competencia: string;
  rendaBase: number;
  totalPrevistoMes: number;
  totalRecorrentes: number;
  totalParcelas: number;
  totalVariavel: number;
  saldoMes: number;
  categorias: DecomposicaoCategoriaItem[];
}
