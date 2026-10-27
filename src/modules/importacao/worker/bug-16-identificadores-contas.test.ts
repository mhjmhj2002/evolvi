import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { ImportacaoConsolidacaoWorkerService } from './importacao-consolidacao-worker.service.js';
import { UniversalStatementParser } from '../../conector/parsers/universal-statement.parser.js';
import { C6InvoicePdfParser } from '../../conector/parsers/c6-invoice-pdf.parser.js';
import { GeminiIaExtratorClient } from './ia-extrator.client.ts';
import crypto from 'node:crypto';

describe('BUG-16: Identificadores Unívocos de Contas e Cartões para Prevenir Fragmentação', () => {
  let usuarioTesteId: string;
  const consolidacaoService = new ImportacaoConsolidacaoWorkerService();

  beforeEach(async () => {
    const usuario = await prisma.usuario.create({
      data: {
        email: `bug16-test-${crypto.randomUUID()}@evolvi.app`,
        nome: 'Usuario Teste BUG-16',
        senhaHash: 'hash-fake',
        role: 'USER',
      },
    });
    usuarioTesteId = usuario.id;
  });

  afterEach(async () => {
    if (usuarioTesteId) {
      await prisma.movimento.deleteMany({ where: { usuarioId: usuarioTesteId } });
      await prisma.conta.deleteMany({ where: { usuarioId: usuarioTesteId } });
      await prisma.usuario.deleteMany({ where: { id: usuarioTesteId } });
    }
  });

  it('1. Deve unificar auto-cadastro de conta corrente quando número de conta coincidir', async () => {
    // 1. Cria conta existente com número de conta cadastrado
    const contaOriginal = await prisma.conta.create({
      data: {
        usuarioId: usuarioTesteId,
        nome: 'Banco Inter Principal',
        tipo: 'CONTA_CORRENTE',
        numeroConta: '24220973',
        agencia: '0001',
      },
    });

    // 2. Tenta obter ou cadastrar com nome ligeiramente diferente (ex: "Conta Corrente (extrato_inter.csv)")
    // mas com o mesmo numeroConta
    const res = await consolidacaoService.obterOuAutoCadastrarConta({
      usuarioId: usuarioTesteId,
      contaSugerida: 'Conta Corrente',
      tipoConta: 'CONTA_CORRENTE',
      arquivoOrigem: 'extrato_inter.csv',
      numeroConta: '24220973-2', // Mesmo número com traço
    });

    expect(res.criadaAgora).toBe(false);
    expect(res.contaId).toBe(contaOriginal.id);
    expect(res.contaNome).toBe('Banco Inter Principal');
  });

  it('2. Deve unificar auto-cadastro de cartão quando os dígitos do cartão coincidirem', async () => {
    // 1. Cria cartão existente com dígitos cadastrados
    const cartaoOriginal = await prisma.conta.create({
      data: {
        usuarioId: usuarioTesteId,
        nome: 'C6 Carbon Final 2458 (MANUEL A H JARA)',
        tipo: 'CARTAO_CREDITO',
        digitosCartao: '2458',
      },
    });

    // 2. Nova importação onde nome sugerido veio genérico "Cartão de Crédito", mas possui digitosCartao '2458'
    const res = await consolidacaoService.obterOuAutoCadastrarConta({
      usuarioId: usuarioTesteId,
      contaSugerida: 'Cartão de Crédito',
      tipoConta: 'CARTAO_CREDITO',
      arquivoOrigem: 'fatura_c6_jan.pdf',
      digitosCartao: '2458',
    });

    expect(res.criadaAgora).toBe(false);
    expect(res.contaId).toBe(cartaoOriginal.id);
  });

  it('3. Deve enriquecer conta existente com numeroConta e digitosCartao caso não existissem', async () => {
    const contaSemNumero = await prisma.conta.create({
      data: {
        usuarioId: usuarioTesteId,
        nome: 'Nubank',
        tipo: 'CONTA_CORRENTE',
      },
    });

    const res = await consolidacaoService.obterOuAutoCadastrarConta({
      usuarioId: usuarioTesteId,
      contaSugerida: 'Nubank',
      tipoConta: 'CONTA_CORRENTE',
      numeroConta: '12345678',
      digitosCartao: '9988',
    });

    expect(res.criadaAgora).toBe(false);
    expect(res.contaId).toBe(contaSemNumero.id);

    const contaAtualizada = await prisma.conta.findUnique({ where: { id: contaSemNumero.id } });
    expect(contaAtualizada?.numeroConta).toBe('12345678');
    expect(contaAtualizada?.digitosCartao).toBe('9988');
  });

  it('4. UniversalStatementParser deve extrair numeroConta de OFX e CSV pré-cabeçalho', () => {
    const parser = new UniversalStatementParser();

    // Teste OFX
    const ofxContent = `
OFXHEADER:100
<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKACCTFROM>
<BANKID>077
<ACCTID>24220973
</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261010
<TRNAMT>-150.00
<FITID>12345
<MEMO>SUPERMERCADO
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

    const resOfx = parser.parse(ofxContent, 'extrato.ofx');
    expect(resOfx.contaSugerida?.numeroConta).toBe('24220973');

    // Teste CSV com linha de metadados
    const csvContent = `Banco Inter S.A.
Conta Corrente: 24220973-2
Agência: 0001
Data;Histórico;Valor
10/10/2026;PADARIA;-15,00`;

    const resCsv = parser.parse(csvContent, 'extrato.csv');
    expect(resCsv.contaSugerida?.numeroConta).toBe('24220973-2');
    expect(resCsv.contaSugerida?.agencia).toBe('0001');
  });

  it('5. C6InvoicePdfParser deve extrair digitosCartao e numeroConta do cabeçalho', () => {
    const textoFatura = `
Fatura C6 Bank
Vencimento: 20/01/2026
C6 Carbon Final 2458 - MANUEL A H JARA
28 jan    PADARIA DINIZ                                75,00
`;
    const txsFatura = C6InvoicePdfParser.parse(textoFatura);
    expect(txsFatura.length).toBe(1);
    expect(txsFatura[0].digitosCartao).toBe('2458');

    const textoExtrato = `
Extrato C6 Bank
Agência: 1 • Conta: 24220973-2
Outubro 2026 (01/10/2026 a 31/10/2026)
18/10                  18/10                   Débito de Cartão   PadariaDiniz VILA VELHA BRA                                                                     -R$ 7,60
`;
    const txsExtrato = C6InvoicePdfParser.parse(textoExtrato);
    expect(txsExtrato.length).toBe(1);
    expect(txsExtrato[0].numeroConta).toBe('242209732');
  });
});
