# Skill de extração de extrato: Mercado Pago

Use estas orientações somente para extratos que identifiquem Mercado Pago. A skill foi elaborada a partir dos extratos mensais de julho a outubro de 2026 e complementa a [skill genérica de extrato](generica-extrato.md).

## Cabeçalho e tabela de movimentos

- O cabeçalho pode apresentar titular, CPF/CNPJ, agência, conta e período. Use esses dados explícitos para identificar a conta; nomes de contrapartes nas descrições não substituem os dados do titular.
- `Data de geração` indica quando o documento foi produzido, não a data do movimento. Use a data da linha em `DETALHE DOS MOVIMENTOS`.
- Cada movimento contém data, descrição, `ID da operação`, valor e saldo. Preserve o ID em `idOrigem` quando o schema permitir. O saldo da linha é o saldo corrido após o movimento, não uma segunda operação.
- O sinal do valor indica o sentido. Retorne o valor como número positivo e represente débito/crédito em `natureza`, conforme o schema.
- `Saldo inicial`, `Saldo final`, totais de `Entradas` e `Saídas` são resumos de conferência, não movimentos.

## IDs, reembolsos e pagamentos

- Não use o ID da operação sozinho para deduplicar. No extrato de outubro, `Pagamento com Pix CAIXA ECONOMICA FEDERAL` de R$ 36,00 negativo e `Reembolso de pagamento com Pix CAIXA ECONOMICA FEDERAL` de R$ 36,00 positivo aparecem com o mesmo ID `184086527990`; são dois movimentos opostos e ambos devem ser mantidos.
- Preserve a descrição de reembolso e o sentido indicado pelo sinal. Não compense o par nem elimine um dos registros.
- `Pagamento de fatura Cartão de crédito` listado no extrato da conta é um débito efetivo de caixa. Classifique como transferência própria com `isPagamentoFatura = true`, conforme o schema. Isso é diferente de uma linha informativa de pagamento dentro da própria fatura do cartão.
- Pix enviado/recebido são movimentos conforme sinal e descrição. O nome do titular na descrição, isoladamente, não prova titularidade comum entre as contas.

## Evidência e escopo

As amostras têm uma página e usam datas completas no formato `DD-MM-AAAA`. O extrato de julho mostra um Pix recebido; setembro mostra pagamento de fatura, Pix enviado e pagamento de conta; outubro mostra Pix, reembolso e Pix enviados. Extraia somente as linhas presentes na tabela, sem criar movimentos para dias sem atividade nem estender dados para completar todo o período.
