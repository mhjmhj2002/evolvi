function normalizarIndicadorFinanceiro(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Só reconhece quitação de fatura quando há ação de pagamento e referência explícita a fatura/cartão. */
export function descricaoIndicaPagamentoFatura(descricao: string): boolean {
  const texto = normalizarIndicadorFinanceiro(descricao || '');
  const mencionaCartao = /\b(?:cartao(?:\s+de\s+credito)?|credit\s+card)\b/.test(texto);
  const mencionaFatura = /\bfatura\b/.test(texto);
  const mencionaPagamento = /\b(?:pagamento|pagto|pgto|pagar|pago|paga|quitacao|quitado|quitada|debito\s+automatico|payment|paid|settlement)\b/.test(texto);
  const pagamentoDeCartaoExplicito = /\b(?:pagamento|pagto|pgto)\s+(?:de|do|da)?\s*cartao\b/.test(texto);

  return mencionaPagamento && mencionaCartao && (mencionaFatura || pagamentoDeCartaoExplicito);
}

/** Nomes de pessoas não provam titularidade; exige texto explícito sobre conta própria ou titularidade. */
export function descricaoIndicaTransferenciaPropria(descricao: string): boolean {
  const texto = normalizarIndicadorFinanceiro(descricao || '');
  return (
    descricaoIndicaPagamentoFatura(descricao || '') ||
    /\b(?:transferencia propria|mesma titularidade|mesmo titular|contas proprias|contas do proprio titular|minhas contas|minha propria conta)\b/.test(texto) ||
    /\b(?:transferencia|pix|ted)\b.{0,60}\b(?:entre minhas contas|entre contas proprias|entre contas do mesmo titular|para minha conta|para conta de mesma titularidade)\b/.test(texto)
  );
}
