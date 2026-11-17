# Skill de extração: Banco Inter

Use estas orientações somente para extratos que identifiquem Banco Inter. Esta skill foi elaborada a partir do extrato de conta de 01/04/2026 a 31/10/2026 e complementa a [skill genérica de extrato](generica-extrato.md).

## Estrutura do extrato

- O documento apresenta titular, instituição, agência, conta e período no cabeçalho. “Solicitado em” indica quando o PDF foi gerado; não é data de lançamento.
- A movimentação é organizada por grupos diários. Um cabeçalho equivalente a “12 de Julho de 2026 — Saldo do dia: ...” estabelece a data das linhas de transação daquele grupo até o próximo cabeçalho diário.
- A data de um grupo pode aparecer no fim de uma página e suas transações começarem na página seguinte, depois do rodapé de atendimento e da quebra de página. Preserve a data do grupo através do rodapé e da quebra; não use o número do dia da próxima transação ou o início da página para inventar outra data.
- Exemplo deste PDF: o cabeçalho “12 de Julho de 2026 — Saldo do dia: R$ 6.614,65” aparece no fim de uma página; a compra de débito de R$ 9,50 aparece no início da página seguinte e pertence a 12/07. O próximo grupo, iniciado por “13 de Julho de 2026”, começa depois dessa compra. Não mova a compra para 13/07.

## Valor e saldo

- Em cada linha de transação, use o valor associado à descrição (coluna “Valor”) como valor do lançamento. O campo “Saldo por transação” é o saldo acumulado após o movimento; nunca o extraia como outro lançamento.
- “Saldo do dia”, saldo total, saldo disponível, saldo bloqueado e resumos são informações de saldo, não movimentações.
- O sinal junto ao valor indica débito ou crédito. Preserve as transações distintas mesmo que tenham valores, descrições ou beneficiários iguais.
- Linhas como “Compra no débito”, “Pix enviado”, “Pix recebido”, “Pagamento efetuado”, “Devolução”, IOF, juros e créditos de eventos de investimento são movimentações quando aparecem na lista diária com valor e saldo por transação. Não descarte uma linha apenas por o nome da descrição parecer informativo.
- Um crédito de rendimento/evento de investimento listado na conta corrente é um crédito efetivo na conta; não o transforme em aporte ou em saldo de investimento. Classifique a natureza conforme o sentido da entrada e mantenha a origem/conta indicada pelo contexto da seção.

## Escopo e datas

- Extraia as linhas da lista diária de movimentações. Não transforme o saldo mostrado no cabeçalho diário, saldos de abertura/fechamento ou o total do período em lançamentos.
- Use a data do cabeçalho diário mais próximo que governa a linha, respeitando a continuidade entre páginas. Não use “Solicitado em” nem datas de criação/impressão do PDF como data de movimento.
- O período impresso no cabeçalho delimita o extrato, mas não substitui a data específica de cada grupo diário.

