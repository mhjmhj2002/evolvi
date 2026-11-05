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

export const queryProjecaoTresCamadasSchema = z.object({
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

export interface ItemGastoRecorrente {
  id: string;
  descricao: string;
  categoriaNome: string;
  valorMensal: number;
  diaPrevisto?: number | null;
  essencial: boolean;
  origem: 'CADASTRO' | 'EXTRATO_DETECTADO';
  ocorrenciasDetectadas?: number;
}

export interface ItemParcelamentoFuturo {
  id: string;
  descricao: string;
  categoriaNome: string;
  contaNome: string;
  parcelaValor: number;
  parcelaAtual: number;
  totalParcelas: number;
  parcelasRestantes: number;
  saldoDevedorRestante: number;
  primeiroVencimento: string;
  ultimoVencimento: string;
  impactoPeriodo: number; // soma das parcelas que vencem dentro da janela de X meses
  mediaMensalNaJanela: number; // impactoPeriodo / mesesJanela
}

export interface ItemGastoVariavel {
  categoriaId?: string | null;
  categoriaNome: string;
  mediaMensalEfetiva: number;
  totalPeriodoEfetivo: number;
  totalPeriodoBruto: number;
  totalExcluido: number;
  qtdLancamentos: number;
}

export interface ProjecaoTresCamadasResponse {
  competenciaReferencia: string;
  mesesJanela: number;
  mesesProjetados: string[];
  rendaBaseMensal: number;

  // Bloco 1: Recorrentes
  recorrentes: {
    itens: ItemGastoRecorrente[];
    mediaMensal: number;
    totalPeriodo: number;
  };

  // Bloco 2: Parcelamentos Futuros
  parcelamentos: {
    itens: ItemParcelamentoFuturo[];
    mediaMensal: number;
    totalPeriodo: number;
  };

  // Bloco 3: Gastos Variáveis
  variaveis: {
    itens: ItemGastoVariavel[];
    mediaMensal: number;
    totalPeriodo: number;
  };

  // Fechamento e Fórmula
  sintese: {
    mediaRecorrentes: number;
    mediaParcelados: number;
    mediaVariaveis: number;
    mediaTotalProjetada: number; // mediaRecorrentes + mediaParcelados + mediaVariaveis
    totalGeralPeriodo: number;
    saldoMensalProjetado: number;
    statusSaldo: 'SUPERAVIT' | 'DEFICIT' | 'ZERO_A_ZERO';
    formulaExplicativa: string;
  };
}
