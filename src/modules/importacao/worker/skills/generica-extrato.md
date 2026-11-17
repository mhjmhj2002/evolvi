# Skill genérica de extração financeira

## Fonte do lançamento

- Extraia lançamentos da seção que registra a movimentação contabilizada da conta ou do cartão, por exemplo uma tabela de atividade com data, descrição, valor e, às vezes, saldo.
- Trate comprovantes, recibos, confirmações, autenticações e detalhes de execução como evidências. Se o mesmo pagamento também aparecer na movimentação contabilizada, retorne somente a linha da movimentação.
- Datas de execução e de contabilização podem ser diferentes, inclusive quando uma operação é feita em fim de semana ou feriado. Não considere a diferença como uma segunda operação e não troque a data da movimentação pela data do comprovante.
- Use identificadores, beneficiário, valor e contexto para reconhecer que comprovante e linha contabilizada descrevem o mesmo evento. Não exija igualdade de datas para reconhecer a relação.
- Não crie um lançamento a partir de um comprovante quando o mesmo evento já estiver listado na movimentação contabilizada. Se o arquivo contiver apenas comprovantes, não os apresente como movimentos contabilizados de extrato.
- Continue extraindo operações distintas da movimentação, mesmo quando coincidirem valor, data ou beneficiário. Não deduplique apenas por igualdade de valor, data ou nome.
- A extração exaustiva vale para lançamentos da fonte canônica; não transforme linhas de evidência, saldos, resumos ou subtotais em lançamentos.

## Tipos de seção

Seções financeiras independentes de poupança, investimento ou cartão também podem conter lançamentos próprios. Extraia-as como movimentos do produto correspondente e não as confunda com comprovantes anexos ou com a tabela de outra conta.

## Incerteza

Se não for possível distinguir a seção de movimentação contabilizada das evidências de execução, não escolha uma das datas por palpite. Preserve o contexto e sinalize a ambiguidade conforme o formato de saída disponível.
