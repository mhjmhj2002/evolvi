import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PdfTextExtractor } from '../../conector/parsers/pdf-text-extractor.js';
import { C6InvoicePdfParser } from '../../conector/parsers/c6-invoice-pdf.parser.js';
import { GeminiIaExtratorClient } from './ia-extrator.client.js';

describe('BUG-05: Extração Incompleta e Valor Irreal na Importação de Fatura PDF (C6 Bank)', () => {
  const pdfPath = path.resolve(
    process.cwd(),
    '.local/Financas/01_ORIGINAIS/2026/2026-01/99_HISTORICO/LIDO__01-Fatura-CPF-8.pdf'
  );

  it('1. Extração Textual Prévia de PDFs via PdfTextExtractor', () => {
    expect(fs.existsSync(pdfPath)).toBe(true);
    const buffer = fs.readFileSync(pdfPath);
    const textoExtraido = PdfTextExtractor.extrairTexto(buffer);

    expect(textoExtraido).toBeDefined();
    expect(textoExtraido.length).toBeGreaterThan(1000);
    expect(textoExtraido).toContain('5.686,66');
    expect(textoExtraido).toContain('MANUEL ALEJANDRO');
    expect(textoExtraido).toContain('Cartão C6 Carbon');
  });

  it('2. Parser Heurístico Especializado C6 Bank identifica fatura e extrai itens', () => {
    const buffer = fs.readFileSync(pdfPath);
    const textoExtraido = PdfTextExtractor.extrairTexto(buffer);

    expect(C6InvoicePdfParser.isC6Invoice(textoExtraido)).toBe(true);

    const transacoes = C6InvoicePdfParser.parse(textoExtraido, {
      dataReferencia: '2026-01-20',
    });

    // Deve extrair exatamente as 66 transações discriminadas no documento
    expect(transacoes.length).toBe(66);

    // Validação de despesas vs pagamento de fatura
    const pagamentos = transacoes.filter((t) => t.isPagamentoFatura);
    expect(pagamentos.length).toBe(1);
    expect(pagamentos[0].descricao).toBe('Pag Fatura Boleto');
    expect(pagamentos[0].valor).toBe(4248.15);
    expect(pagamentos[0].natureza).toBe('TRANSFERENCIA_PROPRIA');

    const despesas = transacoes.filter((t) => !t.isPagamentoFatura);
    expect(despesas.length).toBe(65);

    // Soma das despesas deve bater exatamente o total da fatura R$ 5.686,66
    const totalDespesas = despesas.reduce((acc, t) => acc + t.valor, 0);
    expect(Number(totalDespesas.toFixed(2))).toBe(5686.66);

    // Nenhuma transação pode ter valor absurdo de R$ 52.995,00
    expect(transacoes.some((t) => t.valor >= 50000)).toBe(false);
  });

  it('3. Extração Exaustiva dos Itens preserva dados, parcelas e cartões múltiplos', () => {
    const buffer = fs.readFileSync(pdfPath);
    const textoExtraido = PdfTextExtractor.extrairTexto(buffer);
    const transacoes = C6InvoicePdfParser.parse(textoExtraido, {
      dataReferencia: '2026-01-20',
    });

    // Transações parceladas (ex: Parcela 12/12, 1/10, etc.)
    const botoesthetic = transacoes.find((t) => t.descricao.includes('BOTOESTHETIC'));
    expect(botoesthetic).toBeDefined();
    expect(botoesthetic?.valor).toBe(75.0);
    expect(botoesthetic?.parcelaAtual).toBe(12);
    expect(botoesthetic?.totalParcelas).toBe(12);

    const amazon = transacoes.find((t) => t.descricao.includes('AMAZON BR'));
    expect(amazon).toBeDefined();
    expect(amazon?.valor).toBe(74.91);
    expect(amazon?.parcelaAtual).toBe(6);
    expect(amazon?.totalParcelas).toBe(12);

    // Múltiplos cartões identificados (titular e adicionais)
    const contasSugeridas = new Set(transacoes.map((t) => t.contaSugerida));
    expect(contasSugeridas.size).toBeGreaterThanOrEqual(4);
    expect(Array.from(contasSugeridas).some((c) => c?.includes('2458'))).toBe(true);
    expect(Array.from(contasSugeridas).some((c) => c?.includes('7936'))).toBe(true);
    expect(Array.from(contasSugeridas).some((c) => c?.includes('9886'))).toBe(true);
  });

  it('4. Bloqueio de Fallback Cego em Binários não inventa transações em buffers vazios/ilegíveis', () => {
    const client = new GeminiIaExtratorClient();

    // Buffer binário aleatório que não é PDF de fatura válido nem tem texto legível
    const bufferAleatorio = Buffer.from([0x00, 0x1f, 0x8b, 0x08, 0x00, 0x55, 0x29, 0x95]);
    const resultado = client.extrairLocalDeterministic({
      nomeArquivo: 'arquivo_corrompido.pdf',
      conteudoBuffer: bufferAleatorio,
      contexto: {
        contas: [],
        categorias: [],
        dataReferencia: '2026-01-20',
      },
    });

    // Deve retornar array vazio e NÃO gerar transação de 52995 ou de valor aleatório
    expect(resultado).toEqual([]);
  });

  it('5. Integração com GeminiIaExtratorClient executa extração real sem fallback binário', async () => {
    const client = new GeminiIaExtratorClient();
    const buffer = fs.readFileSync(pdfPath);

    const resultado = await client.extrairTransacoes({
      nomeArquivo: 'LIDO__01-Fatura-CPF-8.pdf',
      mimeType: 'application/pdf',
      conteudoBuffer: buffer,
      contexto: {
        contas: [{ id: 'conta-c6', nome: 'Cartão C6 Carbon', tipo: 'CARTAO_CREDITO' }],
        categorias: [
          { id: 'cat-alimentacao', nome: 'Alimentação' },
          { id: 'cat-saude', nome: 'Saúde' },
          { id: 'cat-transporte', nome: 'Transporte' },
        ],
        dataReferencia: '2026-01-20',
      },
    });

    expect(resultado.length).toBe(66);
    expect(resultado.every((t) => t.valor > 0 && t.valor < 50000)).toBe(true);
    expect(resultado.filter((t) => t.isPagamentoFatura).length).toBe(1);
    expect(resultado.filter((t) => !t.isPagamentoFatura).length).toBe(65);
  });
});
