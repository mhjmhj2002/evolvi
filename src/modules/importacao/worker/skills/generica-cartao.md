# Skill genérica de extração de fatura de cartão

Use estas orientações para faturas de cartão de crédito quando não houver uma skill específica com evidência aplicável.

## Fonte e classificação dos movimentos

- Extraia compras, tarifas, juros, créditos, estornos e pagamentos apenas das seções que listam transações efetivas da fatura. Preserve operações distintas mesmo quando coincidirem em valor, data ou estabelecimento.
- Compras são despesas do cartão. Créditos e estornos reduzem o saldo e devem manter seu sentido e descrição; não compense nem descarte pares de cobrança e estorno.
- Pagamentos da fatura exibidos como crédito são quitações informativas, não compras, receitas nem novas despesas. Use `TRANSFERENCIA_PROPRIA`, `isPagamentoFatura = true` e a observação `Informativo de quitação em fatura de cartão`, conforme o schema. O débito na conta bancária é o movimento de caixa; evite contá-lo de novo como gasto.
- Use a data da compra apresentada na linha. Não troque por emissão, fechamento, vencimento ou pagamento da fatura. Se o ano estiver omitido, derive-o do período explicitamente indicado, datas próximas e contexto da parcela; se ainda houver dúvida, sinalize a incerteza em vez de adivinhar.
- Registre apenas o valor da parcela cobrada no ciclo atual e preserve `parcelaAtual` e `totalParcelas` quando informados. Não multiplique o valor nem crie parcelas futuras.
- Preserve os dígitos do cartão e o titular adicional quando disponíveis para identificar a origem da linha, sem inferir uma conta bancária diferente.

## Conteúdo que não é movimento

- Totais, subtotais, resumos por categoria, limite, saldo futuro, pagamento mínimo, alternativas de parcelamento e simulações de juros são informações de contexto, não movimentos adicionais.
- Extraia juros, IOF e tarifas apenas quando forem lançamentos efetivos discriminados na seção de transações; taxas e encargos estimados em cenários não são transações.
- QR Code, código de barras, boleto, instruções de pagamento e o valor total repetido nesses blocos não são lançamentos. Não duplique pagamentos identificados na tabela.
- Projeções de próxima fatura e parcelas futuras não pertencem ao ciclo atual.
