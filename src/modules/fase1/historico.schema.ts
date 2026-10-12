import { z } from 'zod';

export const queryFase1HistoricoSchema = z.object({
  competenciaReferencia: z
    .string()
    .regex(/^\d{4}-\d{2}$/, { message: 'Competência de referência deve estar no formato YYYY-MM' })
    .optional(),
  mesesJanela: z
    .coerce
    .number()
    .int()
    .min(1)
    .max(24)
    .optional(),
});

export type QueryFase1HistoricoInput = z.infer<typeof queryFase1HistoricoSchema>;

export interface HistoricoFechamentoMes {
  competencia: string;
  totalDespesas: number;
  totalReceitas: number;
  saldoMes: number;
  quantidadeLancamentos: number;
}

export interface HistoricoSubcategoriaItem {
  subcategoria_id: string;
  nome: string;
  total_periodo: number;
  media_mensal: number;
  percentual_na_categoria: number;
  quantidade_lancamentos: number;
  ticket_medio_lancamento: number;
}

export interface HistoricoCategoriaItem {
  categoria_id: string;
  nome: string;
  ordem: number;
  total_periodo: number;
  media_mensal: number;
  percentual_participacao: number;
  quantidade_lancamentos: number;
  ticket_medio_lancamento: number;
  subcategorias: HistoricoSubcategoriaItem[];
  // Comparativo com mês corrente aberto (se houver dados)
  mes_aberto_valor: number;
  mes_aberto_diff_media: number; // mes_aberto_valor - media_mensal
}

export interface HistoricoResumoResponse {
  janela: {
    inicio: string;
    fim: string;
    total_meses: number;
    meses_fechados: string[];
    competencia_aberta?: string;
  };
  renda_base_mensal: number;
  total_periodo_despesas: number;
  media_mensal_despesas: number;
  total_periodo_receitas: number;
  media_mensal_receitas: number;
  quantidade_total_lancamentos: number;
  ticket_medio_global: number;
  fechamentos_mensais: HistoricoFechamentoMes[];
  comparativo_mes_aberto?: {
    competencia: string;
    totalDespesas: number;
    totalReceitas: number;
    diferencaDespesaVsMedia: number; // totalDespesas - media_mensal_despesas
    pctAtingimentoMedia: number;
  };
}

export interface HistoricoCategoriasResponse {
  janela: {
    inicio: string;
    fim: string;
    meses_fechados: string[];
  };
  total_periodo: number;
  media_mensal: number;
  categorias: HistoricoCategoriaItem[];
}
