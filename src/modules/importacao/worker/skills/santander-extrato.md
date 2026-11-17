# Skill de extração: Santander

Use estas orientações somente para extratos que identifiquem Santander. A skill foi elaborada a partir do extrato de maio de 2026 e complementa a [skill genérica de extrato](generica-extrato.md).

## Movimentação contabilizada

- No extrato consolidado, a tabela da conta corrente é reconhecível por cabeçalho equivalente a “Data / Descrição / Nº Documento / Movimento (R$) / Saldo (R$)”. As linhas dessa tabela são a fonte dos lançamentos da conta corrente.
- Se o mesmo PDF tiver seções próprias de movimentação de poupança ou investimento, elas também são fontes de lançamentos do respectivo produto. Não misture suas operações com a conta corrente. A exclusão abaixo se aplica a comprovantes, não a essas seções financeiras.
- Leia a data impressa junto ao grupo da linha na tabela de movimentação e propague-a apenas às linhas seguintes sem data até a próxima data explícita. Não deduza datas pelo dia da semana ou por regra de compensação.

## Comprovantes de pagamento

- Seções intituladas “Comprovantes de Pagamento” ou tabelas de comprovantes com campos como canal, tipo, favorecido, ISPB, agência, conta e valor descrevem execução/confirmação. Não extraia essas linhas como novos lançamentos quando o movimento já estiver na tabela da conta.
- A data no comprovante pode ser anterior à data contabilizada. No PDF de maio, o PIX de R$ 500 para Daniela aparece na tabela da conta em 18/05/2026 e no comprovante em 17/05/2026. Gere somente o lançamento da tabela em 18/05.
- Outro exemplo do mesmo PDF: PIX de R$ 80 para Manuel na movimentação em 04/05 e no comprovante com data de execução 02/05. Mantenha somente a movimentação de 04/05.
- Para comprovante sem linha correspondente na movimentação, não presuma que seja uma saída ou entrada contabilizada nesse extrato. Não o inclua no array de lançamentos do extrato.
- Use os detalhes do comprovante para esclarecer beneficiário ou identificador quando necessário, sem substituir a data, o valor ou a existência do lançamento na movimentação contabilizada.

Essas regras descrevem a função das seções observadas no documento e não autorizam inferências fixas por calendário ou criação de parser determinístico.
