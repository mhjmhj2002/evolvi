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
  limpo = limpo.replace(/^(compra\s+(?:no\s+d[ée]bito|com\s+cart[ãa]o|de\s+cart[ãa]o|cart[ãa]o|a\s+vista)\s*(?:[\-_–—]\s*|:\s*no\s+estabelecimento\s*|:\s*)?)/i, '');
  limpo = limpo.replace(/^(d[ée]bito\s+de\s+cart[ãa]o\s*(?:[\-_–—]\s*)?)/i, '');
  limpo = limpo.replace(/^(compra\s+(?:no\s+cr[ée]dito|parcelada)\s*(?:[\-_–—]\s*)?)/i, '');
  limpo = limpo.replace(/^(pagamento\s+(?:de\s+boleto\s+efetuado|efetuado|de\s+(?:boleto|fatura|t[íi]tulo)|da\s+fatura|fatura|recebido)|pag\s+fatura(?:\s+boleto)?)\s*(?:[\-_–—]\s*)?/i, '');
  limpo = limpo.replace(/^(pgto|pagto|pgamento)\s*(?:[\-_–—]\s*)?/i, '');
  limpo = limpo.replace(/^(pix\s+(?:enviado|recebido|transf)\s*(?:[\-_–—]\s*)?)/i, '');
  limpo = limpo.replace(/^(transfer[êe]ncia\s+(?:enviada|recebida)(?:\s+pelo\s+pix)?\s*(?:[\-_–—]\s*)?)/i, '');
  limpo = limpo.replace(/^(ted|doc)\s+(?:conta\s+sal[áa]rio|recebida|enviada)?\s*(?:[\-_–—]\s*)?/i, '');

  // Remove sufixos informativos entre parênteses no final, ex: '(Transferência enviada)'
  limpo = limpo.replace(/\s*\((?:transfer[êe]ncia\s+enviada|transfer[êe]ncia\s+recebida|pix\s+enviado|pix\s+recebido)\)\s*$/i, '');

  // 2. Remove sufixo país 'bra' ou 'brasil' no final
  limpo = limpo.replace(/\s+bra$/i, '');
  limpo = limpo.replace(/(mart|flor)bra$/i, '$1');

  // 3. Remove sufixos geográficos comuns e de município/estado
  const geoPattern = /(?:vila\s+velha|vitoria|vitória|serra|cariacica|domingos\s+martins|domingos\s+mart|marechal\s+floriano|marechal\s+flor|osasco|sao\s+paulo|são\s+paulo|sp|es|rj|mg|brasil|bra)/i;
  limpo = limpo.replace(new RegExp(`\\s+${geoPattern.source}\\s*$`, 'i'), '');
  limpo = limpo.replace(new RegExp(`\\s+${geoPattern.source}\\s*$`, 'i'), '');
  limpo = limpo.replace(new RegExp(`\\s*[\\-_–—]\\s*${geoPattern.source}\\s*$`, 'i'), '');

  // 4. Remove indicação de parcelamento ex: " - Parcela 2/2" ou " (Parcela 02 de 03)"
  limpo = limpo.replace(/\s*(?:[\-_–—]|\()\s*parcela\s+\d+\s*(?:\/|\s+de\s+)\s*\d+\s*\)?/i, '');

  // 5. Remove fração direta ao final (ex: " 001/012", " - 02/06")
  limpo = limpo.replace(/(?:\s*(?:[\-_–—]|\()?)\s*\d{1,3}\s*(?:\/|\s+de\s+)\s*\d{1,3}\s*\)?$/i, '');

  // 6. Remove sufixos comuns de filial, loja e matriz (ex: 'LOJA 01', 'FILIAL 2', 'MATRIZ')
  limpo = limpo.replace(/\s+(?:loja\s*\d+|filial\s*\d+|unidade\s*\d+|matriz)$/i, '');

  // 7. Remove hífens, travessões e espaços redundantes nas extremidades
  limpo = limpo.replace(/^[\s\-_–—]+|[\s\-_–—]+$/g, '').trim();

  return limpo;
}

export interface InfoParcelamento {
  prefixoBase: string;
  parcelaAtual: number;
  totalParcelas: number;
}

/**
 * Detecta se a descrição de um lançamento corresponde a uma compra parcelada
 * (ex: "UP - Parcela 4/6", "BIKE OLI - Parcela 2 de 3", "LE SAC (Parcela 02 de 06)", "SEG SUPERPROTEG ESSENCIAL 001/012").
 */
export function extrairInfoParcelamento(descricao: string): InfoParcelamento | null {
  const limpo = (descricao || '').trim();

  // Padrão 1: Contém expressamente a palavra "parcela" seguida de X/Y ou X de Y
  const matchComPalavra = limpo.match(/^(.*?)(?:\s*(?:[\-_–—]|\()\s*parcela\s+(\d+)\s*(?:\/|\s+de\s+)\s*(\d+)\s*\)?)/i);
  if (matchComPalavra) {
    let base = matchComPalavra[1].replace(/^[\s\-_–—]+|[\s\-_–—]+$/g, '').trim();
    // Limpar fração residual do tipo '001/012' ou '01/10' ao final da base
    base = base.replace(/(?:\s*(?:[\-_–—]|\()?)\s*\d{1,3}\s*(?:\/|\s+de\s+)\s*\d{1,3}\s*\)?$/i, '').trim();
    return {
      prefixoBase: base,
      parcelaAtual: parseInt(matchComPalavra[2], 10),
      totalParcelas: parseInt(matchComPalavra[3], 10),
    };
  }

  // Padrão 2: Fração direta ao final ou com/sem traço (ex: "LOJA ABC - 02/06", "SEG SUPERPROTEG ESSENCIAL 001/012")
  const matchFracaoFinal = limpo.match(/^(.*?)(?:\s*(?:[\-_–—]|\()?)\s*(\d{1,3})\s*(?:\/|\s+de\s+)\s*(\d{1,3})\s*\)?$/i);
  if (matchFracaoFinal) {
    const base = matchFracaoFinal[1].replace(/^[\s\-_–—]+|[\s\-_–—]+$/g, '').trim();
    const pAtual = parseInt(matchFracaoFinal[2], 10);
    const pTotal = parseInt(matchFracaoFinal[3], 10);
    if (pAtual <= pTotal && pTotal > 1) {
      return {
        prefixoBase: base,
        parcelaAtual: pAtual,
        totalParcelas: pTotal,
      };
    }
  }

  return null;
}

/**
 * Retorna uma expressão regular para casar todas as parcelas irmãs de uma mesma compra parcelada.
 */
export function gerarRegexParcelasIrmas(info: InfoParcelamento): RegExp {
  const baseEscapada = info.prefixoBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^${baseEscapada}\\s*(?:[\\-_–—]|\\()\\s*(?:parcela\\s+)?\\d+\\s*(?:\\/|\\s+de\\s+)\\s*${info.totalParcelas}\\s*\\)?`,
    'i'
  );
}
