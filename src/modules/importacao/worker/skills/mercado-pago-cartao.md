# Skill de extração de fatura de cartão: Mercado Pago

Use estas orientações somente para faturas que identifiquem Mercado Pago. A skill foi elaborada a partir das faturas de março a setembro de 2026 e complementa a [skill genérica de cartão](generica-cartao.md).

## Fonte dos movimentos

- Extraia as compras e parcelas da seção `Detalhes de consumo`, dentro dos blocos `Cartão Visa [final]`. Preserve o final do cartão, a descrição, a data, o valor e a indicação de parcela.
- A seção `Movimentações na fatura` pode listar créditos aplicados diretamente à fatura, como `Crédito concedido`. Preserve cada linha como crédito/ajuste da fatura, não como compra nem como entrada de dinheiro na conta bancária. Não compense com compras.
- Use o dia/mês da linha como data da operação. O ano pode estar omitido; determine-o pelo intervalo de consumo explicitamente impresso, pelo fechamento e por datas completas no documento. Se não for possível estabelecer o ano, sinalize a incerteza.
- Faturas extensas podem continuar o mesmo cartão em outra página. Preserve as linhas da continuação, mas não trate cabeçalhos repetidos nem subtotais repetidos como novas operações.
- Compras parceladas entram pelo valor cobrado nesta fatura. Preserve `Parcela N de M`; não multiplique pelo número de parcelas e não crie movimentos futuros.

## Pagamentos, totais e informações de contexto

- O total a pagar é o resultado líquido da fatura após compras, créditos e outros ajustes. Não o extraia como movimento adicional às linhas detalhadas.
- Totais por cartão e por página são subtotais de conferência. Não os some novamente como transações; o mesmo total pode reaparecer na página de continuação do cartão.
- Pagamento mínimo, parcelamento ofertado, juros e IOF simulados, limite, saques disponíveis e lançamentos futuros são informações de contexto. Só extraia encargos/tarifas quando houver uma linha efetiva no detalhe de consumo.
- QR Code, boleto e instruções de pagamento não são movimentos. Se um pagamento aparecer como linha informativa dentro da fatura, classifique-o como quitação, conforme a skill genérica de cartão; o débito correspondente no extrato da conta é o movimento de caixa.
- Faturas sem consumo ou com total zero não geram movimentos a partir de limites, tarifas hipotéticas ou seções explicativas.
