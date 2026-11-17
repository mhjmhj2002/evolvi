# Skill de extração de extrato: PagBank

Use estas orientações somente para extratos que identifiquem PagBank/PagSeguro. Esta skill foi elaborada a partir do extrato de 01/04/2026 a 30/07/2026 e complementa a [skill genérica de extrato](generica-extrato.md).

## Cabeçalho e período

- O cabeçalho identifica titular, CPF, agência e conta. Use os dados explicitamente impressos para identificar a conta; não trate os dados de outra instituição mencionada em uma descrição como conta do titular.
- `Emitido em` é a data de geração do documento e não a data de uma transação. Use o período declarado no extrato como contexto geral e a data completa de cada linha como data do movimento.
- Extraia somente as linhas presentes na tabela. Não crie movimentos para os dias sem atividade nem complete o período com base no nome do arquivo.

## Tabela de movimentações

- A tabela apresenta `Data`, `Descrição` e `Valor`. Cada linha com uma operação e valor é um movimento da conta; use a data e o valor associados à própria linha.
- `Saldo do dia` é saldo acumulado para conferência, não é transação. Não o inclua no conjunto de movimentos nem o confunda com o valor de uma operação.
- Valores negativos indicam saídas e positivos indicam entradas. Retorne o valor como número positivo e represente o sentido em `natureza`, conforme o schema.
- `Resgate de CDB` e `Aplicação em CDB` são movimentos reais listados na conta PagBank. Preserve-os como movimentos da conta; classifique a aplicação como aporte patrimonial. Não transforme saldo diário em posição de investimento nem classifique automaticamente o resgate como renda.
- `Rendimento da conta - Rendimento líquido sobre dinheiro em conta` é crédito efetivo quando aparece como linha da tabela. Preserve a data e classifique a entrada como receita; não a confunda com saldo ou rendimento de investimento fora da conta.
- `Pix enviado` e `Pix recebido` são movimentos conforme o sinal e a descrição. Um nome igual ao do titular, isoladamente, não prova que a outra conta é da mesma titularidade; aplique a regra genérica de titularidade própria.

## Evidência da amostra

O PDF analisado tem uma página, com movimentos entre 20/04 e 22/07/2026. As linhas `Saldo do dia` aparecem após grupos de operações e servem como conferência; por exemplo, em 22/04 há Pix enviado, resgate de CDB e outro Pix enviado antes do saldo diário de R$ 150,00. Em 25/05, a aplicação de R$ 10.000,00 e o Pix recebido de R$ 10.000,00 são duas linhas distintas, embora o saldo do dia permaneça em R$ 151,31.

O intervalo impresso termina em 30/07, mas a última operação observada é de 22/07. Não infira lançamentos para os dias restantes do período.
