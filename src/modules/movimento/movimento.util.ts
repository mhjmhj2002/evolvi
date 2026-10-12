import crypto from 'node:crypto';

/**
 * Utilitário para gerar hash determinístico de deduplicação caso não informado explicitamente.
 */
export function gerarChaveDedupe(params: {
  contaId: string;
  dataMovimento: string;
  valor: number;
  descricao: string;
}): string {
  const normalizada = `${params.contaId}|${params.dataMovimento}|${params.valor.toFixed(2)}|${params.descricao.trim().toLowerCase()}`;
  return crypto.createHash('sha256').update(normalizada).digest('hex');
}
