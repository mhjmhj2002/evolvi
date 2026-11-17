# Skill de extração de cartão: Banco Inter

Use estas orientações somente para faturas que identifiquem Banco Inter. Complementa a [skill genérica de cartão](generica-cartao.md) e foi elaborada a partir da fatura com vencimento em 22/10/2026.

## Seções e linhas da fatura

- A seção `Despesas da fatura` é a fonte das compras e demais movimentos do cartão. Extraia cada linha uma vez, preservando data, descrição, valor e final do cartão quando disponível.
- Use a data mostrada na coluna `Data` como data da compra. Não substitua por emissão, vencimento, corte ou pagamento.
- Compras parceladas entram pelo valor da parcela da fatura atual. Preserve `Parcela N de M`; não multiplique pelo total nem crie movimentos para parcelas futuras.
- A linha `PAGTO DEBITO AUTOMATICO`, quando aparece com valor positivo na tabela, é quitação que reduz o saldo devido. Classifique como transferência própria e informativo de quitação, sem tratá-la como despesa ou receita.
- Na amostra, “Próxima fatura” mostra parcelas futuras; não as misture com as despesas atuais. Os totais da fatura, valor antecipado, pagamento mínimo, encargos simulados e opções de parcelamento também são resumos, não novos lançamentos.
