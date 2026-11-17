export interface PeriodoExtrato {
  inicio: string;
  fim: string;
  origem: 'nome_arquivo' | 'inventario';
}

export interface DataTransacaoValidada {
  original: string;
  final: string;
  corrigida: boolean;
}

function isoValido(ano: number, mes: number, dia: number): string | null {
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) return null;
  return `${ano.toString().padStart(4, '0')}-${mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
}

export function inferirPeriodoExtrato(nomeArquivo: string, dataInicial?: Date | null, dataFinal?: Date | null): PeriodoExtrato | null {
  const datas = [...nomeArquivo.matchAll(/(?<!\d)(\d{2})[-_.](\d{2})[-_.](\d{4})(?!\d)/g)];
  if (datas.length >= 2) {
    const a = isoValido(Number(datas[0][3]), Number(datas[0][2]), Number(datas[0][1]));
    const b = isoValido(Number(datas[1][3]), Number(datas[1][2]), Number(datas[1][1]));
    if (a && b && a <= b) return { inicio: a, fim: b, origem: 'nome_arquivo' };
  }
  const meses = [...nomeArquivo.matchAll(/(?<!\d)(\d{4})[-_.](0[1-9]|1[0-2])(?!\d)/g)];
  if (meses.length) {
    const [ano, mes] = [Number(meses[meses.length - 1][1]), Number(meses[meses.length - 1][2])];
    const fim = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    return { inicio: `${ano}-${mes.toString().padStart(2, '0')}-01`, fim: `${ano}-${mes.toString().padStart(2, '0')}-${fim}`, origem: 'nome_arquivo' };
  }
  if (dataInicial && dataFinal) {
    const inicio = dataInicial.toISOString().slice(0, 10);
    const fim = dataFinal.toISOString().slice(0, 10);
    if (inicio <= fim) return { inicio, fim, origem: 'inventario' };
  }
  return null;
}

export function validarDatasContraPeriodo(datas: string[], periodo: PeriodoExtrato): {
  datas: DataTransacaoValidada[];
  inconsistencias: Array<{ indice: number; data: string; periodo: PeriodoExtrato }>;
} {
  const resultado: DataTransacaoValidada[] = [];
  const inconsistencias: Array<{ indice: number; data: string; periodo: PeriodoExtrato }> = [];
  for (const [indice, original] of datas.entries()) {
    if (original >= periodo.inicio && original <= periodo.fim) {
      resultado.push({ original, final: original, corrigida: false });
      continue;
    }
    const [, mes, dia] = original.split('-').map(Number);
    const anoInicio = Number(periodo.inicio.slice(0, 4));
    const anoFim = Number(periodo.fim.slice(0, 4));
    const anos = Array.from({ length: anoFim - anoInicio + 1 }, (_, indice) => anoInicio + indice);
    // Só corrige automaticamente quando o intervalo vem do nome do arquivo,
    // que é evidência externa ao extrator. Inventário produzido pela IA pode
    // sustentar o alerta, mas não é base suficiente para mudar uma data.
    const candidatas = (periodo.origem === 'nome_arquivo' ? anos : []).map((anoCandidato) => isoValido(anoCandidato, mes, dia))
      .filter((data): data is string => Boolean(data && data >= periodo.inicio && data <= periodo.fim));
    if (candidatas.length === 1) resultado.push({ original, final: candidatas[0], corrigida: true });
    else {
      resultado.push({ original, final: original, corrigida: false });
      inconsistencias.push({ indice, data: original, periodo });
    }
  }
  return { datas: resultado, inconsistencias };
}
