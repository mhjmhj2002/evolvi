# Skill de extração: Nubank

Use estas orientações somente para extratos que identifiquem Nubank. Esta skill foi iniciada pelo CSV mensal de maio e ampliada com lançamentos reais do CSV de julho de 2026; complementa a [skill genérica de extrato](generica-extrato.md).

## CSV mensal da conta

- O CSV usa cabeçalho `Data,Valor,Identificador,Descrição`, codificação UTF-8, delimitador vírgula e valores decimais com ponto.
- `Data` é a data do lançamento em `DD/MM/AAAA`.
- `Valor` traz o sentido no sinal: positivo para crédito e negativo para débito. Retorne `valor` como número positivo e represente o sentido em `natureza`, conforme o schema.
- `Identificador` contém um UUID. Preserve-o como `idOrigem`, mas não o use sozinho para deduplicar: em julho, um débito de R$ 450,00 e seu estorno aparecem com o mesmo UUID, mesma data e valores de sinais opostos. São dois movimentos distintos e ambos devem ser mantidos.
- `Descrição` contém o tipo e os detalhes da operação. Mantenha uma descrição concisa, sem tratar dados mascarados de CPF, conta/agência ou banco da contraparte como dados da conta do titular.
- O texto da descrição diferencia operações que podem ter valores iguais: por exemplo, `Transferência enviada pelo Pix` e `Estorno - Transferência enviada pelo Pix`. Preserve a informação de estorno e seu sentido indicado pelo sinal de `Valor`.
- Uma transferência recebida pelo Pix pode incluir nome, CPF mascarado, banco, agência e conta da contraparte na descrição. Esses dados descrevem a origem da transferência, não são campos para inferir ou substituir a conta do titular.
- Não derive lançamentos do nome do arquivo, do período no nome ou de arquivos de outros meses. O CSV é a fonte dos próprios movimentos.
- Se o arquivo tiver somente o cabeçalho, retorne zero transações. Não preencha o mês com dados de fatura, extrato de outro mês ou estimativas.

## Evidência das amostras

O arquivo `NU_44719326_01MAI2026_31MAI2026.csv` contém somente o cabeçalho, sem movimentos. Já `NU_44719326_01JUL2026_31JUL2026.csv` contém nove lançamentos: compras no débito, Pix enviados e recebidos, e um débito de R$ 450,00 acompanhado de estorno de R$ 450,00 na mesma data e com o mesmo UUID. A amostra comprova que UUID repetido não significa necessariamente duplicidade.

## Formatos estruturados

CSV com esse cabeçalho é formato estruturado e deve seguir o parser universal de CSV do sistema. Esta skill registra o significado dos campos para o fluxo de IA quando necessário; não substitui nem cria parsing determinístico específico do Nubank.
