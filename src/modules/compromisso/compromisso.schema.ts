import { z } from 'zod';

export const queryVencimentosSchema = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/, { message: 'Competência deve estar no formato YYYY-MM' }),
});

export type QueryVencimentosInput = z.infer<typeof queryVencimentosSchema>;

export interface ItemCronogramaVencimento {
  tipo: 'RECORRENCIA' | 'PARCELAMENTO' | 'CONTA_PAGAR';
  origemId: string;
  descricao: string;
  valor: number;
  diaVencimento: number;
  dataVencimentoPrevista: string; // YYYY-MM-DD
  essencial?: boolean;
  status?: string;
  categoria?: {
    id: string;
    nome: string;
  } | null;
  conta?: {
    id: string;
    nome: string;
    tipo: string;
  } | null;
  parcelamentoInfo?: {
    parcelaAtualNoMes: number;
    totalParcelas: number;
    saldoDevedorRestanteAposMes: number;
    primeiroVencimento?: string;
    dataCompra?: string;
  };
  dataCompra?: string;
}

export interface CronogramaVencimentosResponse {
  competencia: string;
  totalPrevistoMes: number;
  totalRecorrencias: number;
  totalParcelamentos: number;
  totalContasPagar?: number;
  itens: ItemCronogramaVencimento[];
}
