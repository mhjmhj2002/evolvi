import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { GeminiIaExtratorClient } from './ia-extrator.client.js';
import { UniversalStatementParser } from '../../conector/parsers/universal-statement.parser.js';

describe('BUG-06: Rigor Exclusivo da IA e Bloqueio de Fallbacks Heurísticos Cegos sem IA', () => {
  const faturaSantanderPath = path.resolve(
    process.cwd(),
    '.local/Financas/01_ORIGINAIS/2026/2026-09/99_HISTORICO/LIDO__Fatura_Santander_2026-09.pdf'
  );
  const faturaMercadoPagoPath = path.resolve(
    process.cwd(),
    '.local/Financas/01_ORIGINAIS/2026/2026-09/99_HISTORICO/LIDO__Fatura_Mercado_Pago_2026-09.pdf'
  );

  const contextoPadrao = {
    contas: [
      { id: 'c1', nome: 'Santander', tipo: 'CARTAO_CREDITO' },
      { id: 'c2', nome: 'Mercado Pago', tipo: 'CARTAO_CREDITO' },
    ],
    categorias: [
      { id: 'cat1', nome: 'Alimentação' },
      { id: 'cat2', nome: 'Serviços Bancários e Financeiros' },
    ],
    dataReferencia: '2026-09-20',
  };

  it('1. Rigor Exclusivo da IA: rejeita PDFs complexos com erro explícito se não houver chave de IA', async () => {
    // Cliente instanciado explicitamente sem apiKey (simulando ambiente sem chave ou falha)
    const clientSemChave = new GeminiIaExtratorClient('');

    // Buffer da fatura Santander
    const bufferSantander = fs.existsSync(faturaSantanderPath)
      ? fs.readFileSync(faturaSantanderPath)
      : Buffer.from('%PDF-1.4 fatura complexa santander limite R$ 9.040,00', 'utf-8');

    await expect(
      clientSemChave.extrairTransacoes({
        nomeArquivo: 'LIDO__Fatura_Santander_2026-09.pdf',
        mimeType: 'application/pdf',
        conteudoBuffer: bufferSantander,
        contexto: contextoPadrao,
      })
    ).rejects.toThrow('A IA não conseguiu processar este documento');
  });

  it('2. Bloqueio de Adivinhação de Limites de Crédito em Código (Santander e Mercado Pago)', async () => {
    const client = new GeminiIaExtratorClient('');

    // Texto simulando cabeçalhos com limites de crédito e linhas informativas
    const textoComLimitesSantander = `
      BANCO SANTANDER (BRASIL) S.A. CNPJ 90.400.888/0001-42
      Limite de Crédito Total: R$ 9.040,00
      Limite de Saque à Vista: R$ 9.040,00
      Limite para Compras Parceladas: R$ 9.040,00
      Central de Atendimento: 4004-3535
    `;

    // Chamada a extrairLocalDeterministic NUNCA deve casar limites de crédito nem gerar lançamentos
    const transacoesExtraidas = client.extrairLocalDeterministic({
      nomeArquivo: 'LIDO__Fatura_Santander_2026-09.pdf',
      conteudoBuffer: Buffer.from(textoComLimitesSantander, 'utf-8'),
      conteudoTexto: textoComLimitesSantander,
      contexto: contextoPadrao,
    });

    expect(transacoesExtraidas).toEqual([]);
    expect(transacoesExtraidas.some((t) => t.valor === 9040.0)).toBe(false);

    // Texto simulando fatura Mercado Pago com limite de R$ 18.200,00
    const textoComLimitesMercadoPago = `
      MERCADO PAGO INSTITUICAO DE PAGAMENTO LTDA
      Limite total do cartão de crédito: R$ 18.200,00
      Limite disponível: R$ 18.200,00
      Saque no Banco24Horas: R$ 50,00
    `;

    const transacoesMercadoPago = client.extrairLocalDeterministic({
      nomeArquivo: 'LIDO__Fatura_Mercado_Pago_2026-09.pdf',
      conteudoBuffer: Buffer.from(textoComLimitesMercadoPago, 'utf-8'),
      conteudoTexto: textoComLimitesMercadoPago,
      contexto: contextoPadrao,
    });

    expect(transacoesMercadoPago).toEqual([]);
    expect(transacoesMercadoPago.some((t) => t.valor === 18200.0)).toBe(false);
  });

  it('3. Formatos puramente tabulares/bancários padrão (OFX, CSV com cabeçalho) continuam suportados estritamente', async () => {
    const client = new GeminiIaExtratorClient('');

    // CSV bancário com cabeçalho rigoroso
    const csvValido = `Data;Descricao;Valor\n15/09/2026;Restaurante Silva;65,40\n16/09/2026;Farmácia Preço Baixo;32,10`;
    const transacoesCsv = await client.extrairTransacoes({
      nomeArquivo: 'extrato_setembro.csv',
      mimeType: 'text/csv',
      conteudoBuffer: Buffer.from(csvValido, 'utf-8'),
      contexto: contextoPadrao,
    });

    expect(transacoesCsv.length).toBe(2);
    expect(transacoesCsv[0].descricao).toBe('Restaurante Silva');
    expect(transacoesCsv[0].valor).toBe(65.4);
    expect(transacoesCsv[1].descricao).toBe('Farmácia Preço Baixo');
    expect(transacoesCsv[1].valor).toBe(32.1);

    // OFX padrão
    const ofxValido = `
      <OFX>
        <BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
          <STMTTRN>
            <TRNTYPE>DEBIT
            <DTPOSTED>20260918120000
            <TRNAMT>-120.00
            <MEMO>SUPERMERCADO CENTRAL
          </STMTTRN>
        </BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1>
      </OFX>
    `;

    const transacoesOfx = await client.extrairTransacoes({
      nomeArquivo: 'extrato.ofx',
      mimeType: 'application/x-ofx',
      conteudoBuffer: Buffer.from(ofxValido, 'utf-8'),
      contexto: contextoPadrao,
    });

    expect(transacoesOfx.length).toBe(1);
    expect(transacoesOfx[0].descricao).toBe('SUPERMERCADO CENTRAL');
    expect(transacoesOfx[0].valor).toBe(120.0);
  });

  it('4. Rejeição estrita no UniversalStatementParser para CSVs sem cabeçalho bancário de data e valor', () => {
    const parser = new UniversalStatementParser();

    // Texto livre ou sem cabeçalho padrão
    const textoLivre = `
      Algum texto sem delimitador ou colunas de data e valor
      Linha com 15/09/2026 e R$ 50,00
    `;

    const resultado = parser.parseCSV(textoLivre);
    expect(resultado.transacoes.length).toBe(0);
    expect(resultado.erros.length).toBeGreaterThan(0);
    expect(resultado.erros[0]).toContain('delimitador tabular reconhecível');
  });
});
