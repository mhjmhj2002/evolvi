/**
 * Calcula a competência adicionando N meses à competência base (YYYY-MM).
 */
export function addMesesCompetencia(competencia: string, meses: number): string {
  const [anoStr, mesStr] = competencia.split('-');
  let ano = parseInt(anoStr, 10);
  let mes = parseInt(mesStr, 10);

  mes += meses;
  while (mes > 12) {
    mes -= 12;
    ano += 1;
  }
  while (mes < 1) {
    mes += 12;
    ano -= 1;
  }

  return `${ano}-${String(mes).padStart(2, '0')}`;
}

export interface ParcelamentoCalculado {
  id: string;
  usuarioId: string;
  contaId: string | null;
  categoriaId: string | null;
  descricao: string;
  valorTotal: number;
  parcelaValor: number;
  parcelaAtual: number;
  totalParcelas: number;
  primeiroVencimento: string;
  ultimoVencimento: string;
  status: 'ATIVO' | 'QUITADO' | 'CANCELADO';
  criadoEm: Date;
  parcelasRestantes: number;
  saldoDevedorRestante: number;
  conta?: {
    id: string;
    nome: string;
    tipo: string;
    diaVencimento: number | null;
  } | null;
  categoria?: {
    id: string;
    nome: string;
  } | null;
}

export function formatarParcelamento(parcelamento: any): ParcelamentoCalculado {
  const valorTotal = Number(parcelamento.valorTotal);
  const parcelaValor = Number(parcelamento.parcelaValor);
  const parcelaAtual = Number(parcelamento.parcelaAtual);
  const totalParcelas = Number(parcelamento.totalParcelas);

  // Se já quitado ou cancelado, parcelas restantes e saldo são 0
  let parcelasRestantes = 0;
  let saldoDevedorRestante = 0;

  if (parcelamento.status === 'ATIVO') {
    // Ex: 10 parcelas no total, parcelaAtual = 1 -> faltam 10 - 1 + 1 = 10 parcelas a pagar considerando a atual,
    // ou se parcelaAtual é a que está vencendo no mês corrente:
    // O número de parcelas que ainda restam ser pagas a partir da atual (inclusive) é (totalParcelas - parcelaAtual + 1).
    // Se parcelaAtual > totalParcelas, já quitou.
    if (parcelaAtual <= totalParcelas) {
      parcelasRestantes = totalParcelas - parcelaAtual + 1;
      saldoDevedorRestante = Number((parcelasRestantes * parcelaValor).toFixed(2));
    }
  }

  return {
    ...parcelamento,
    valorTotal,
    parcelaValor,
    parcelaAtual,
    totalParcelas,
    parcelasRestantes,
    saldoDevedorRestante,
  };
}
