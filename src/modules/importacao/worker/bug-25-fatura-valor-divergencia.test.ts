import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PdfTextExtractor } from '../../conector/parsers/pdf-text-extractor.js';
import { C6InvoicePdfParser } from '../../conector/parsers/c6-invoice-pdf.parser.js';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { FaturaConciliacaoService } from '../../movimento/fatura-conciliacao.service.js';
import { buildApp } from '../../../app.js';
import { FastifyInstance } from 'fastify';

describe('BUG-25: Divergência de Valor Total da Fatura na Importação por IA e Conciliação', () => {
  let app: FastifyInstance;
  const pdfFaturaAbrilPath = path.resolve(
    process.cwd(),
    '.local/documentacao/lancamentos/04-Fatura-CPF-5.pdf'
  );

  it('1. Extração de metadados da fatura C6 Bank captura o valor exato oficial (R$ 4.766,65) e a data de vencimento', () => {
    expect(fs.existsSync(pdfFaturaAbrilPath)).toBe(true);
    const buffer = fs.readFileSync(pdfFaturaAbrilPath);
    const textoExtraido = PdfTextExtractor.extrairTexto(buffer);

    expect(C6InvoicePdfParser.isC6Invoice(textoExtraido)).toBe(true);

    const metadados = C6InvoicePdfParser.extrairMetadadosFatura(textoExtraido);
    expect(metadados.eFaturaCartao).toBe(true);
    // Deve capturar exatamente R$ 4.766,65 do cabeçalho oficial da fatura (e não a soma não-abatida de 4.962,65)
    expect(metadados.faturaValorTotal).toBe(4766.65);
    expect(metadados.faturaDataVencimento).toBeDefined();
    expect(metadados.faturaDataVencimento?.toISOString()).toContain('2026-04-20');
  });

  it('2. Parser tabular C6 gera compras com estornos com saldo líquido batendo exatamente R$ 4.766,65', () => {
    const buffer = fs.readFileSync(pdfFaturaAbrilPath);
    const textoExtraido = PdfTextExtractor.extrairTexto(buffer);

    const transacoes = C6InvoicePdfParser.parse(textoExtraido, {
      dataReferencia: '2026-04-20',
    });

    // 71 transações no total (1 pagamento de fatura anterior + 1 estorno + 69 compras normais = 70 compras no ciclo)
    expect(transacoes.length).toBe(71);

    const comprasEEstornos = transacoes.filter((t) => !t.isPagamentoFatura);
    expect(comprasEEstornos.length).toBe(70);

    const estornos = comprasEEstornos.filter((t) => t.natureza === 'RECEITA');
    expect(estornos.length).toBe(1);
    expect(estornos[0].valor).toBe(98);

    const somaLiquida = comprasEEstornos.reduce((acc, t) => {
      return t.natureza === 'RECEITA' ? acc - t.valor : acc + t.valor;
    }, 0);

    expect(Number(somaLiquida.toFixed(2))).toBe(4766.65);
  });

  it('3. Conciliação automática vincula débito bancário (R$ 4.766,65) com a fatura e limpa suspeitas pendentes', async () => {
    app = await buildApp();
    await app.ready();

    // Cria usuário de teste isolado
    const email = `user-bug25-${Date.now()}@teste.com`;
    const resCad = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario BUG-25 Fatura',
        email,
        senha: 'SenhaForte123!',
      },
    });
    const bodyCad = JSON.parse(resCad.body);
    const usuarioId = bodyCad.usuario.id;

    // Cria conta corrente Santander
    const contaSantander = await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Santander',
        tipo: 'CONTA_CORRENTE',
      },
    });

    // Cria lote de importação
    const lote = await prisma.loteImportacao.create({
      data: {
        usuarioId,
        caminhoDiretorio: `test-lote-bug25-${Date.now()}`,
        status: 'CONCLUIDO',
      },
    });

    // Cria arquivo de fatura importada com o valor corrigido R$ 4.766,65
    const arquivoFatura = await prisma.arquivoImportacao.create({
      data: {
        loteId: lote.id,
        usuarioId,
        nomeArquivo: '04-Fatura-CPF-04.pdf',
        caminhoRelativo: '04-Fatura-CPF-04.pdf',
        tamanhoBytes: 1024,
        status: 'IA_CONCLUIDO',
        statusFinal: 'SUCESSO',
        eFaturaCartao: true,
        faturaDataVencimento: new Date('2026-04-20T12:00:00.000Z'),
        faturaValorTotal: 4766.65,
        faturaStatusValidacao: 'PENDENTE',
      },
    });

    // Cria lançamento de débito no extrato Santander (20/04/2026, R$ 4.766,65)
    const movPagamento = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: contaSantander.id,
        dataMovimento: new Date('2026-04-20T10:00:00.000Z'),
        competencia: '2026-04',
        descricao: 'PAGAMENTO DE BOLETO OUTROS BANCOS - BANCO C6 S.A.',
        valor: 4766.65,
        natureza: 'DESPESA',
        origemDocumento: 'extrato-santander-abril.pdf',
      },
    });

    // Cria suspeita pré-existente para o movimento
    await prisma.suspeitaMovimento.create({
      data: {
        usuarioId,
        movimentoId: movPagamento.id,
        tipo: 'SUSPEITA_CATEGORIZACAO',
        status: 'PENDENTE',
        confianca: 0.8,
        motivo: 'Alta Materialidade em "Outros" / Sem Categoria',
        sugestaoNatureza: 'DESPESA',
      },
    });

    // Executa o serviço de conciliação de faturas
    const resultado = await FaturaConciliacaoService.executarParaUsuario(usuarioId);

    expect(resultado.totalFaturasConciliadas).toBe(1);
    expect(resultado.detalhes[0].status).toBe('CONCILIADO');
    expect(resultado.detalhes[0].arquivoId).toBe(arquivoFatura.id);
    expect(resultado.detalhes[0].movimentoPagamentoId).toBe(movPagamento.id);

    // O movimento bancário deve ter sido convertido para TRANSFERENCIA_PROPRIA com observação de conciliação
    const movAtualizado = await prisma.movimento.findUnique({
      where: { id: movPagamento.id },
    });
    expect(movAtualizado?.natureza).toBe('TRANSFERENCIA_PROPRIA');
    expect(movAtualizado?.categoriaId).toBeNull();
    expect(movAtualizado?.observacao).toContain('Pagamento de Fatura Conciliado');

    // A fatura deve estar marcada como CONCILIADO e vinculada ao movimento
    const faturaAtualizada = await prisma.arquivoImportacao.findUnique({
      where: { id: arquivoFatura.id },
    });
    expect(faturaAtualizada?.faturaStatusValidacao).toBe('CONCILIADO');
    expect(faturaAtualizada?.faturaPagamentoMovimentoId).toBe(movPagamento.id);

    // A suspeita deve ter sido removida
    const suspeitaRestante = await prisma.suspeitaMovimento.findFirst({
      where: {
        usuarioId,
        movimentoId: movPagamento.id,
      },
    });
    expect(suspeitaRestante).toBeNull();

    await app.close();
  });
});
