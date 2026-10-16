import crypto from 'node:crypto';

/**
 * Utilitário para gerar hash determinístico de deduplicação caso não informado explicitamente.
 */
export function gerarChaveDedupe(params: {
  contaId: string;
  dataMovimento: string;
  valor: number;
  descricao: string;
  idOrigem?: string | null;
  ocorrencia?: number;
}): string {
  if (params.idOrigem && params.idOrigem.trim()) {
    const normalizadaComId = `ID|${params.contaId}|${params.idOrigem.trim()}|${params.valor.toFixed(2)}`;
    return crypto.createHash('sha256').update(normalizadaComId).digest('hex');
  }

  const sufixoOcorrencia = params.ocorrencia && params.ocorrencia > 1 ? `|OCC:${params.ocorrencia}` : '';
  const normalizada = `${params.contaId}|${params.dataMovimento}|${params.valor.toFixed(2)}|${params.descricao.trim().toLowerCase()}${sufixoOcorrencia}`;
  return crypto.createHash('sha256').update(normalizada).digest('hex');
}

/**
 * Normaliza e extrai a raiz identificadora de um comerciante/vendedor/estabelecimento
 * a partir do texto descritivo do lançamento, desconsiderando prefixos bancários,
 * sufixos geográficos (município/UF/país) e identificadores secundários de transação.
 */
export function extrairRaizComerciante(descricao: string): string {
  let limpo = (descricao || '').trim();

  // 1. Remove prefixos comuns bancários/cartão/transacionais
  limpo = limpo.replace(/^(compra\s+no\s+d[ée]bito\s*(?:-\s*|:\s*no\s+estabelecimento\s*|:\s*)?)/i, '');
  limpo = limpo.replace(/^(d[ée]bito\s+de\s+cart[ãa]o\s*)/i, '');
  limpo = limpo.replace(/^(compra\s+(?:no\s+cr[ée]dito|parcelada)\s*(?:-\s*)?)/i, '');
  limpo = limpo.replace(/^(pagamento\s+de\s+(?:boleto|fatura|t[íi]tulo)\s*(?:-\s*)?)/i, '');
  limpo = limpo.replace(/^(pix\s+(?:enviado|recebido)\s*(?:-\s*)?)/i, '');

  // 2. Remove sufixos geográficos comuns e de país (aplicado duas vezes para padrões como "VILA VELHA BRA")
  limpo = limpo.replace(/\s+(?:vila\s+velha|vitoria|vitória|serra|cariacica|sao\s+paulo|são\s+paulo|sp|es|rj|mg|bra|brasil)\s*$/i, '');
  limpo = limpo.replace(/\s+(?:vila\s+velha|vitoria|vitória|serra|cariacica|sao\s+paulo|são\s+paulo|sp|es|rj|mg|bra|brasil)\s*$/i, '');
  limpo = limpo.replace(/\s*-\s*(?:vila\s+velha|vitoria|vitória|serra|cariacica|sao\s+paulo|são\s+paulo|sp|es|rj|mg)\s*$/i, '');

  // 3. Remove indicação de parcelamento ex: " - Parcela 2/2"
  limpo = limpo.replace(/\s*-\s*parcela\s+\d+\/\d+/i, '');

  // 4. Remove algarismo romano ou dígito solto no final (ex: "BARRACA DO JULIO I" -> "BARRACA DO JULIO")
  limpo = limpo.replace(/\s+[IVXLCDM\d]+\s*$/i, '');

  // 5. Remove hífens e espaços redundantes nas extremidades
  limpo = limpo.replace(/^[\s-]+|[\s-]+$/g, '').trim();

  return limpo;
}
