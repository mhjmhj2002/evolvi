# Skill de extração: C6 Bank

Use estas orientações somente para extratos que identifiquem C6 Bank. Esta skill foi elaborada a partir de um extrato de conta corrente anual e complementa a [skill genérica de extrato](generica-extrato.md).

## Estrutura e fonte dos lançamentos

- O cabeçalho identifica o titular, agência, conta, período da exportação e data em que o documento foi exportado. A data de exportação não é data de movimentação.
- O documento agrupa as movimentações por mês. Cada grupo informa o período e totais mensais de entradas e saídas; esses totais servem como conferência e não são lançamentos.
- Dentro de cada mês, a tabela tem colunas equivalentes a “Data da transação”, “Data de processamento”, “Tipo”, “Descrição” e “Valor”. Cada linha de transação é um movimento da conta.
- Use **Data da transação** como `dataMovimento`. A data de processamento é informação auxiliar e pode cair em outro dia, inclusive em mês diferente; não substitua por ela a data da transação. Exemplo do próprio PDF: 14/03 com processamento em 16/03 e 02/05 com processamento em 04/05.
- O ano deve vir do período/título mensal da seção e do período do extrato. As datas DD/MM das linhas pertencem ao mês da respectiva seção. Não use o ano da data de exportação para alterar o período transacionado.

## Valor e saldo contábil

- Use o sinal do valor para identificar débito ou crédito, mas retorne `valor` como número positivo e expresse o sentido em `natureza`, conforme o schema. A coluna não fornece saldo acumulado por linha.
- “Saldo contábil do dia” é saldo de conferência, não uma transação; não o inclua no array.
- “Saldo no dia da exportação”, cheque especial contratado, entradas/saídas mensais e “Sem lançamentos no mês” são metadados ou resumos. Não os converta em movimentos.
- Se um mês informa “Sem lançamentos no mês”, não invente transações para completar o intervalo do extrato.
- Preserve lançamentos distintos mesmo que tenham mesmo tipo, descrição, valor ou data. Não consolide somente por igualdade desses campos.

## Interpretação da coluna Tipo

- Tipos como “Débito de Cartão”, “Entrada PIX”, “Saída PIX”, “Entradas”, “Outros gastos” e “Pagamento” identificam a natureza geral da operação. Use também a descrição e o sinal do valor para classificar receita, despesa, pagamento de fatura ou movimentação de investimento.
- “CASHBACK ATOMOS” é um crédito listado na movimentação da conta, não um resumo.
- “APLICAÇÃO DE CDB” e “RESGATE DE CDB” são movimentos efetivos da conta relacionados a investimento. Não trate aplicação como consumo cotidiano nem transforme automaticamente o resgate em renda operacional; classifique-o conforme a titularidade e a relação entre as contas indicadas no contexto.
- “Pagamento efetuado” permanece uma saída real da conta. Só marque como pagamento de fatura/transferência própria quando a descrição ou o contexto do documento indicar isso explicitamente; não classifique todo pagamento como fatura.

## Paginação

- A tabela e os saldos diários podem continuar na página seguinte. Preserve o mês e o ano da seção até aparecer o próximo título mensal; os cabeçalhos repetidos das colunas não iniciam um novo período.
- Rodapés com paginação e endereço do C6 Bank não são conteúdo transacional.

