import { describe, it, expect } from 'vitest';
import { SantanderStatementPdfParser } from './santander-statement-pdf.parser.js';

describe('SantanderStatementPdfParser (TASK-Santander)', () => {
  const samplePdfText = `
                                                                    EXTRATO DE CONTA
Agência: 3345 | Conta: 01.083048.9
Período: 22/07/2026 a 19/10/2026
Titular: Manuel

  Saldo inicial                     Entradas         Saídas                Saldo final
  R$ 1.038,71                       R$ 10.071,59     R$ 10.502,54          R$ 607,76

DETALHE DOS MOVIMENTOS
Data              Descrição                                               Valor          Saldo

 Segunda, 19 de outubro de 2026
                  Pix recebido
19/10/2026                                                              R$ 40,00        R$ 607,76
                  Luis Alberto Labarca

 Quinta, 15 de outubro de 2026
                  Pagamento cartao credito bce
15/10/2026                                                             -R$ 367,84       -R$ 87,24
                  Banco Santander (br)

 Sexta, 9 de outubro de 2026
09/10/2026        Remuneracao aplicacao automatica                       R$ 0,03        R$ 153,21

                  Operacoes credito imobiliario
09/10/2026                                                             -R$ 1.382,67     R$ 153,18
                  Prest cr im

 Sexta, 2 de outubro de 2026
                  Debito aut. titulo capitalizacao
02/10/2026                                                              -R$ 31,96       R$ 235,85
                  Icb48683937

 Sexta, 11 de setembro de 2026
                  Pix enviado
11/09/2026                                                              -R$ 70,00     R$ 2.132,33
                  62 375 091 Laysa Cali
`;

  it('1. deve reconhecer o extrato do Santander via isSantanderStatement', () => {
    expect(SantanderStatementPdfParser.isSantanderStatement(samplePdfText)).toBe(true);
    expect(SantanderStatementPdfParser.isSantanderStatement('Texto genérico de outro banco')).toBe(false);
  });

  it('2. deve extrair agência, número da conta e titular com precisão', () => {
    const meta = SantanderStatementPdfParser.extrairMetadadosConta(samplePdfText);
    expect(meta.agencia).toBe('3345');
    expect(meta.numeroConta).toBe('010830489');
    expect(meta.titular).toBe('Manuel');
  });

  it('3. deve extrair todas as transações, atribuir à conta Santander e aplicar regras anti-dupla contagem', () => {
    const transacoes = SantanderStatementPdfParser.parse(samplePdfText, {
      dataReferencia: '2026-10-19',
      nomeTitular: 'Manuel Alejandro Hinojosa',
    });

    expect(transacoes.length).toBe(6);

    // Pix recebido
    const pixRecebido = transacoes.find((t) => t.descricao.includes('Luis Alberto Labarca'));
    expect(pixRecebido).toBeDefined();
    expect(pixRecebido?.dataMovimento).toBe('2026-10-19');
    expect(pixRecebido?.valor).toBe(40);
    expect(pixRecebido?.natureza).toBe('RECEITA');
    expect(pixRecebido?.contaSugerida).toBe('Santander');
    expect(pixRecebido?.numeroConta).toBe('010830489');

    // Pagamento cartão de crédito BCE (anti-dupla contagem)
    const pagtoCartao = transacoes.find((t) => t.descricao.includes('Pagamento cartao credito bce'));
    expect(pagtoCartao).toBeDefined();
    expect(pagtoCartao?.dataMovimento).toBe('2026-10-15');
    expect(pagtoCartao?.valor).toBe(367.84);
    expect(pagtoCartao?.natureza).toBe('TRANSFERENCIA_PROPRIA');
    expect(pagtoCartao?.isPagamentoFatura).toBe(true);

    // Remuneração de aplicação automática
    const remun = transacoes.find((t) => t.descricao.includes('Remuneracao aplicacao automatica'));
    expect(remun).toBeDefined();
    expect(remun?.natureza).toBe('RECEITA');
    expect(remun?.categoriaSugerida).toBe('Aplicações / Investimentos');

    // Crédito Imobiliário
    const imob = transacoes.find((t) => t.descricao.includes('Operacoes credito imobiliario'));
    expect(imob).toBeDefined();
    expect(imob?.natureza).toBe('DESPESA');
    expect(imob?.categoriaSugerida).toBe('Habitação');

    // Débito capitalização com idOrigem
    const cap = transacoes.find((t) => t.descricao.includes('Debito aut. titulo capitalizacao'));
    expect(cap).toBeDefined();
    expect(cap?.idOrigem).toBe('Icb48683937');
  });
});
