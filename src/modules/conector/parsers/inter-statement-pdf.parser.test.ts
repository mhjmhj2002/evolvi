import { describe, it, expect } from 'vitest';
import { InterStatementPdfParser } from './inter-statement-pdf.parser.js';

describe('InterStatementPdfParser', () => {
  const samplePdfText = `
                                                                                                               Solicitado em: 31/10/2026 - 17h30




MANUEL ALEJANDRO HINOJOSA JARA
CPF/CNPJ: 059.838.937-77, Instituição: Banco Inter, Agência: 0001-9, Conta: 2422097-3
Período: 01/04/2026 a 31/10/2026


Saldo total                Saldo disponível:    Saldo bloqueado:
R$ 9,38                    R$ 9,38              R$ 0,00
(bloqueado + disponível)




 1 de Abril de 2026 Saldo do dia: R$ 618,42                                                            Valor          Saldo por transação


 Imposto IOF Adicional                                                                              -R$ 0,04                      R$ 618,46

 Juros Cheque Especial                                                                              -R$ 0,04                      R$ 618,42


 2 de Abril de 2026 Saldo do dia: R$ 18,42


 Pix enviado: "Cp :60701190-Manuel Alejandro Hinojosa Jara"                                      -R$ 600,00                         R$ 18,42


 15 de Abril de 2026 Saldo do dia: R$ 8,28


 Credito Evento B3: "* PROV * RENDIMENTO 1 HGLG11"                                                  R$ 1,10                          R$ 8,28


 22 de Abril de 2026 Saldo do dia: R$ 33,72


 Pix recebido: "Cp :08561701-MANUEL ALEJANDRO HINOJOSA JARA"                                      R$ 300,00                       R$ 346,58

 Pagamento efetuado: "Debito Automatico Fatura Cartao Inter"                                     -R$ 312,86                         R$ 33,72


 2 de Maio de 2026 Saldo do dia: R$ 16,61

 Pix recebido: "Cp :90400888-MANUEL ALEJANDRO HINOJOSA JARA"                                R$ 80,00                      R$ 89,73
 Compra no debito: "No estabelecimento PadariaDiniz VILA VELHA BRA"                          -R$ 7,42                     R$ 82,31

Fale com a gente
SAC: 0800 940 9999 (opção 09)                      Ouvidoria: 0800 940 7772             Deficiência de fala e audição: 0800 979 7099
`;

  it('1. deve reconhecer o extrato do Banco Inter via isInterStatement', () => {
    expect(InterStatementPdfParser.isInterStatement(samplePdfText)).toBe(true);
    expect(InterStatementPdfParser.isInterStatement('Texto qualquer de outro banco')).toBe(false);
  });

  it('2. deve extrair agência, número da conta, titular e período com precisão', () => {
    const meta = InterStatementPdfParser.extrairMetadadosConta(samplePdfText);
    expect(meta.agencia).toBe('0001-9');
    expect(meta.numeroConta).toBe('24220973');
    expect(meta.titular).toBe('MANUEL ALEJANDRO HINOJOSA JARA');
    expect(meta.periodoInicio).toBe('01/04/2026');
    expect(meta.periodoFim).toBe('31/10/2026');
  });

  it('3. deve extrair as transações, atribuir à conta Banco Inter e aplicar regras anti-dupla contagem', () => {
    const transacoes = InterStatementPdfParser.parse(samplePdfText, {
      dataReferencia: '2026-10-31',
      nomeTitular: 'MANUEL ALEJANDRO HINOJOSA JARA',
    });

    expect(transacoes.length).toBe(8);

    // 1 de Abril
    expect(transacoes[0].dataMovimento).toBe('2026-04-01');
    expect(transacoes[0].descricao).toBe('Imposto IOF Adicional');
    expect(transacoes[0].valor).toBe(0.04);
    expect(transacoes[0].natureza).toBe('DESPESA');

    // 2 de Abril - PIX para mesmo titular
    expect(transacoes[2].dataMovimento).toBe('2026-04-02');
    expect(transacoes[2].valor).toBe(600);
    expect(transacoes[2].natureza).toBe('TRANSFERENCIA_PROPRIA');

    // 15 de Abril - Rendimento B3
    expect(transacoes[3].dataMovimento).toBe('2026-04-15');
    expect(transacoes[3].valor).toBe(1.1);
    expect(transacoes[3].natureza).toBe('RECEITA');

    // 22 de Abril - Pagamento Fatura Inter
    const pagFatura = transacoes.find((t) => t.descricao.includes('Fatura Cartao Inter'));
    expect(pagFatura).toBeDefined();
    expect(pagFatura?.valor).toBe(312.86);
    expect(pagFatura?.natureza).toBe('TRANSFERENCIA_PROPRIA');
    expect(pagFatura?.isPagamentoFatura).toBe(true);

    // 2 de Maio
    const padaria = transacoes.find((t) => t.descricao.includes('PadariaDiniz'));
    expect(padaria).toBeDefined();
    expect(padaria?.dataMovimento).toBe('2026-05-02');
    expect(padaria?.valor).toBe(7.42);
    expect(padaria?.natureza).toBe('DESPESA');
  });
});
