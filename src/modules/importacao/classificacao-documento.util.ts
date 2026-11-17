type SinalTipoDocumento = {
  tipoConta?: string | null;
};

/**
 * Classifica o documento pela distribuição dos tipos de conta extraídos.
 * Um lançamento isolado pode ter tipo incorreto pela IA e não deve reclassificar
 * todo o arquivo. Aporte patrimonial é natureza do lançamento, não tipo documental.
 */
export function inferirTipoDocumentoImportado(transacoes: SinalTipoDocumento[]) {
  if (transacoes.length === 0) return 'OUTRO' as const;

  const contagem = (tipo: string) => transacoes.filter((t) => t.tipoConta === tipo).length;
  const limiteDominante = transacoes.length / 2;

  if (contagem('CARTAO_CREDITO') > limiteDominante) return 'FATURA_CARTAO' as const;
  if (contagem('INVESTIMENTO') > limiteDominante) return 'EXTRATO_INVESTIMENTO' as const;
  if (contagem('CONTA_CORRENTE') + contagem('POUPANCA') > limiteDominante) {
    return 'EXTRATO_CONTA_CORRENTE' as const;
  }
  return 'OUTRO' as const;
}
