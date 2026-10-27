import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { UniversalStatementParser } from '../../conector/parsers/universal-statement.parser.js';
import { C6InvoicePdfParser } from '../../conector/parsers/c6-invoice-pdf.parser.js';
import { ImportacaoStagingWorkerService } from './importacao-staging-worker.service.js';
import { ImportacaoConsolidacaoWorkerService } from './importacao-consolidacao-worker.service.js';
import { prisma } from '../../../infrastructure/database/prisma.js';

describe('BUG-11, BUG-12 e BUG-13: Robustez de Extração Longa, Datas de Compra e Quitação de Faturas', () => {
  const usuarioTesteId = 'bbbbbbbb-1111-4222-8333-cccccccccccc';
  const loteTesteId = 'dddddddd-1111-4222-8333-cccccccccccc';
  const arquivoTesteId = 'eeeeeeee-1111-4222-8333-cccccccccccc';

  beforeEach(async () => {
    // Limpeza de testes anteriores
    await prisma.movimento.deleteMany({ where: { usuarioId: usuarioTesteId } });
    await prisma.stagingLancamentoImportacao.deleteMany({ where: { loteId: loteTesteId } });
    await prisma.arquivoImportacao.deleteMany({ where: { loteId: loteTesteId } });
    await prisma.loteImportacao.deleteMany({ where: { id: loteTesteId } });
    await prisma.conta.deleteMany({ where: { usuarioId: usuarioTesteId } });
    await prisma.usuario.deleteMany({ where: { id: usuarioTesteId } });

    // Criar usuário para teste
    await prisma.usuario.create({
      data: {
        id: usuarioTesteId,
        nome: 'Usuario Auditoria Bugs',
        email: 'auditoria_bugs@evolvi.com',
        senhaHash: 'hash_fake_teste',
      },
    });
  });

  afterEach(async () => {
    await prisma.movimento.deleteMany({ where: { usuarioId: usuarioTesteId } });
    await prisma.stagingLancamentoImportacao.deleteMany({ where: { loteId: loteTesteId } });
    await prisma.arquivoImportacao.deleteMany({ where: { loteId: loteTesteId } });
    await prisma.loteImportacao.deleteMany({ where: { id: loteTesteId } });
    await prisma.conta.deleteMany({ where: { usuarioId: usuarioTesteId } });
    await prisma.usuario.deleteMany({ where: { id: usuarioTesteId } });
  });

  describe('BUG-11: Extração Completa sem Truncamento em Arquivos Longos (CSV)', () => {
    it('deve extrair todas as 222 transações do extrato CSV do Banco Inter com linhas iniciais de metadados', () => {
      const caminhoCsv = path.resolve(
        process.cwd(),
        '.local/Financas/01_ORIGINAIS/2026/00_MULTIMES/99_HISTORICO/LIDO__Inter_Conta_2026-01_a_2026-09.csv'
      );

      // Se o arquivo real existir na pasta .local, testamos diretamente com ele
      if (fs.existsSync(caminhoCsv)) {
        const conteudo = fs.readFileSync(caminhoCsv, 'utf-8');
        const parser = new UniversalStatementParser();
        const resultado = parser.parseCSV(conteudo);

        expect(resultado.erros.length).toBe(0);
        // O extrato do Inter possui exatamente 222 transações de 02/01/2026 a 16/09/2026
        expect(resultado.transacoes.length).toBe(222);

        // Verifica amplitude de datas (Janeiro a Setembro)
        const datas = resultado.transacoes.map((t) => t.data).sort();
        expect(datas[0].startsWith('2026-01')).toBe(true);
        expect(datas[datas.length - 1].startsWith('2026-09')).toBe(true);
      } else {
        // Fallback para mock caso rodando em ambiente sem o arquivo .local
        const csvSimulado = `Extrato Conta Corrente
Conta: 123456-7
Periodo: 01/01/2026 a 30/06/2026

Data Lançamento;Histórico;Descrição;Valor;Saldo
02/01/2026;PIX ENVIADO;MERCADO BOM;-150,00;1000,00
05/01/2026;PIX RECEBIDO;CLIENTE XYZ;500,00;1500,00
10/01/2026;PAGAMENTO FATURA;FATURA INTER;-800,00;700,00
`;
        const parser = new UniversalStatementParser();
        const resultado = parser.parseCSV(csvSimulado);
        expect(resultado.transacoes.length).toBe(3);
        expect(resultado.transacoes[0].valor).toBe(150.0);
        expect(resultado.transacoes[2].isPagamentoFatura).toBe(true);
      }
    });
  });

  describe('BUG-12: Preservação da Data da Compra em Faturas de Cartão', () => {
    it('deve manter a dataMovimento estritamente igual à data da transação em vez da data de vencimento da fatura', () => {
      const textoFaturaC6 = `
        C6 BANK
        Vencimento: 10/07/2026
        Total da fatura: R$ 350,00

        C6 Carbon Final 1234 - TITULAR CARTAO
        28 mai    RESTAURANTE SABOR VILA VELHA                    150,00
        15 jun    FARMACIA POPULAR - Parcela 1/3                  100,00
        02 jul    SUPERMERCADO CENTRAL                             100,00
      `;

      const transacoes = C6InvoicePdfParser.parse(textoFaturaC6, {
        dataReferencia: '2026-07-01',
      });

      expect(transacoes.length).toBe(3);
      // Compra à vista de 28 de maio deve preservar a data exata da transação 2026-05-28 (e não o vencimento da fatura)
      expect(transacoes[0].dataMovimento).toBe('2026-05-28');
      expect(transacoes[0].descricao).toBe('RESTAURANTE SABOR VILA VELHA');

      // Compra parcelada: a exigibilidade da parcela pertence à competência da fatura em cobrança (2026-07-10)
      // com a data de compra original registrada na observação para auditoria
      expect(transacoes[1].dataMovimento).toBe('2026-07-10');
      expect(transacoes[1].parcelaAtual).toBe(1);
      expect(transacoes[1].totalParcelas).toBe(3);
      expect(transacoes[1].observacao).toContain('Compra original parcelada em 15/06/2026');

      // Compra à vista de 02 de julho deve preservar 2026-07-02
      expect(transacoes[2].dataMovimento).toBe('2026-07-02');
    });
  });

  describe('BUG-13: Anti-Duplicação de Quitação de Fatura entre Extrato e Cartão', () => {
    it('deve marcar linha informativa de quitação no cartão como IGNORADO e manter apenas o débito real da conta', async () => {
      const consolidacaoService = new ImportacaoConsolidacaoWorkerService();

      // Criar lote
      await prisma.loteImportacao.create({
        data: {
          id: loteTesteId,
          usuarioId: usuarioTesteId,
          caminhoDiretorio: 'temp/teste',
          status: 'CARGA_STAGING',
        },
      });

      // Criar arquivo
      await prisma.arquivoImportacao.create({
        data: {
          id: arquivoTesteId,
          loteId: loteTesteId,
          nomeArquivo: 'Fatura_C6_Julho.pdf',
          caminhoRelativo: 'temp/teste/Fatura_C6_Julho.pdf',
          status: 'STAGING_CARREGADO',
        },
      });

      // Inserir duas linhas em staging:
      // 1. Débito do pagamento na Conta Corrente
      // 2. Linha informativa de "Pagamento Recebido" na Fatura do Cartão
      await prisma.stagingLancamentoImportacao.createMany({
        data: [
          {
            loteId: loteTesteId,
            arquivoId: arquivoTesteId,
            arquivoOrigem: 'Extrato_Conta_Corrente.csv',
            dataMovimento: new Date('2026-07-10T00:00:00.000Z'),
            descricao: 'PAGTO FATURA CARTAO C6',
            valor: 1500.0,
            natureza: 'TRANSFERENCIA_PROPRIA',
            contaSugerida: 'Conta Corrente Santander',
            tipoConta: 'CONTA_CORRENTE',
            statusProcessamento: 'PENDENTE',
          },
          {
            loteId: loteTesteId,
            arquivoId: arquivoTesteId,
            arquivoOrigem: 'Fatura_C6_Julho.pdf',
            dataMovimento: new Date('2026-07-10T00:00:00.000Z'),
            descricao: 'PAGAMENTO RECEBIDO',
            valor: 1500.0,
            natureza: 'TRANSFERENCIA_PROPRIA',
            contaSugerida: 'Cartão C6 Carbon',
            tipoConta: 'CARTAO_CREDITO',
            statusProcessamento: 'PENDENTE',
          },
        ],
      });

      // Executar consolidação do lote
      const resultado = await consolidacaoService.consolidarLote(loteTesteId, usuarioTesteId);

      expect(resultado.sucesso).toBe(true);
      // Apenas o débito na conta corrente deve gerar um movimento financeiro
      expect(resultado.novosMovimentosInseridos).toBe(1);
      // A linha informativa do cartão de crédito deve ser ignorada
      expect(resultado.duplicadasIgnoradas).toBe(1);

      // Validar no banco de dados
      const movimentos = await prisma.movimento.findMany({
        where: { usuarioId: usuarioTesteId },
      });
      expect(movimentos.length).toBe(1);
      expect(movimentos[0].descricao).toBe('PAGTO FATURA CARTAO C6');
      expect(movimentos[0].natureza).toBe('TRANSFERENCIA_PROPRIA');

      const itemStagingCartao = await prisma.stagingLancamentoImportacao.findFirst({
        where: { loteId: loteTesteId, tipoConta: 'CARTAO_CREDITO' },
      });
      expect(itemStagingCartao?.statusProcessamento).toBe('IGNORADO');
      expect(itemStagingCartao?.observacao).toContain('Linha informativa de pagamento em fatura de cartão');
    });
  });
});
