/**
 * Utilitários universais de formatação de data para a aplicação Web (Frontend).
 * Padronização estrita: YYYY-MM-DD (aaaa-mm-dd) conforme diretriz do sistema,
 * evitando ambiguidades do formato americano (mm/dd/aaaa) ou conversões indesejadas.
 */

/**
 * Converte qualquer valor representativo de data (Date, string ISO, string YYYY-MM-DD)
 * para o formato estrito 'aaaa-mm-dd' (YYYY-MM-DD).
 */
export function formatarDataIso(valor?: Date | string | null): string {
  if (!valor) return '';

  if (typeof valor === 'string') {
    const trimmed = valor.trim();
    if (!trimmed) return '';

    // Se já estiver no formato AAAA-MM-DD no início da string
    const matchIso = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (matchIso) {
      return matchIso[1];
    }

    // Se vier no formato brasileiro DD/MM/AAAA ou DD-MM-AAAA
    const matchBr = trimmed.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
    if (matchBr) {
      const [, dia, mes, ano] = matchBr;
      return `${ano}-${mes}-${dia}`;
    }

    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }

    return trimmed;
  }

  if (valor instanceof Date && !isNaN(valor.getTime())) {
    return valor.toISOString().split('T')[0];
  }

  return '';
}

/**
 * Formata data e hora no padrão 'aaaa-mm-dd hh:mm' ou 'aaaa-mm-dd hh:mm:ss'
 */
export function formatarDataHoraIso(valor?: Date | string | null, incluirSegundos = false): string {
  if (!valor) return '';
  const parsed = valor instanceof Date ? valor : new Date(valor);
  if (isNaN(parsed.getTime())) return String(valor);

  const pad = (n: number) => String(n).padStart(2, '0');
  const ano = parsed.getFullYear();
  const mes = pad(parsed.getMonth() + 1);
  const dia = pad(parsed.getDate());
  const hora = pad(parsed.getHours());
  const minuto = pad(parsed.getMinutes());

  if (incluirSegundos) {
    const segundo = pad(parsed.getSeconds());
    return `${ano}-${mes}-${dia} ${hora}:${minuto}:${segundo}`;
  }

  return `${ano}-${mes}-${dia} ${hora}:${minuto}`;
}

