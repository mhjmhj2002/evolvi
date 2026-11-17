# Skill de extração de cartão: C6 Bank

Use estas orientações somente para faturas que identifiquem C6 Bank. Complementa a [skill genérica de cartão](generica-cartao.md) e foi elaborada a partir da fatura com vencimento em 20/10/2026.

## Seções e linhas da fatura

- Use as linhas de `Transações do cartão principal` e `Transações dos cartões adicionais` como fonte dos movimentos. Preserve a descrição, o valor, o final do cartão e o titular indicado; os subtotais por cartão são conferência, não lançamentos.
- As datas podem vir como dia e mês sem ano. Considere fechamento da fatura, datas completas no documento e sequência de parcelas; não atribua mecanicamente o ano do fechamento às linhas. Se não houver evidência suficiente, sinalize a incerteza.
- Registre somente o valor da parcela cobrada e mantenha a indicação `Parcela N/M`. Não crie parcelas futuras a partir do saldo de obrigações futuras.
- `Pag Fatura Boleto` é crédito de quitação, não compra. Classifique como transferência própria e informativo de quitação, sem duplicar como gasto o débito correspondente na conta bancária.
- Preserve cobrança e estorno como linhas separadas. Na amostra, `Anuidade Diferenciada - Parcela 11/12` e `Estorno Tarifa - Estorno`, ambos de R$ 98,00, são movimentos opostos distintos; não os compense nem descarte um deles.
- Resumos por categoria, total a pagar, limite, pagamento mínimo, opções e encargos simulados não são lançamentos. Só extraia juros, IOF, tarifa e anuidade quando constarem como linha efetiva nas transações.
