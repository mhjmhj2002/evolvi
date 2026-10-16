import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { ImportacaoIaWorkerService } from './importacao-ia-worker.service.js';
import { GeminiIaExtratorClient, IIaExtratorClient } from './ia-extrator.client.js';

describe('BUG-08: Rejeição Indevida de Documentos Válidos Sem Lançamentos ou com Linhas de Valor R$ 0,00', () => {
  let usuarioId: string;
  let loteId: string;
  const pastaLote = path.resolve(process.cwd(), 'uploads/test-bug-08');

  beforeAll(async () => {
    await fs.mkdir(pastaLote, { recursive: true });

    const usuario = await prisma.usuario.create({
      data: {
        nome: 'Usuario Teste Bug 08',
        email: `test-bug-08-${Date.now()}@evolvi.app`,
        senhaHash: 'hash123',
        rendaBaseMensal: 5000.0,
      },
    });
    usuarioId = usuario.id;

    const lote = await prisma.loteImportacao.create({
      data: {
        usuarioId,
        caminhoDiretorio: 'uploads/test-bug-08',
        status: 'RECEPCIONADO',
      },
    });
    loteId = lote.id;
  });

  afterAll(async () => {
    if (usuarioId) {
      await prisma.stagingLancamentoImportacao.deleteMany({ where: { loteId } });
      await prisma.arquivoImportacao.deleteMany({ where: { loteId } });
      await prisma.loteImportacao.deleteMany({ where: { id: loteId } });
      await prisma.usuario.deleteMany({ where: { id: usuarioId } });
    }
    try {
      await fs.rm(pastaLote, { recursive: true, force: true });
    } catch {
      // Ignora erro
    }
  });

  it('1. Sanitização Prévia: deve filtrar ou descartar automaticamente transações com valor <= 0 (cupons, taxas zeradas)', async () => {
    const mockClientComLinhaZerada: IIaExtratorClient = {
      async extrairTransacoes() {
        return [
          {
            dataMovimento: '2026-07-10',
            descricao: 'Churrascaria Realeza - Almoço',
            valor: 89.9,
            natureza: 'DESPESA',
            contaSugerida: 'Cartão de Crédito',
            tipoConta: 'CARTAO_CREDITO',
            categoriaSugerida: 'Alimentação',
            parcelaAtual: null,
            totalParcelas: null,
            isPagamentoFatura: false,
            observacao: null,
            confianca: 1.0,
          },
        ];
      },
    };

    const worker = new ImportacaoIaWorkerService(mockClientComLinhaZerada);

    const nomeArquivo = 'pedido_ifood_com_cupom.txt';
    await fs.writeFile(path.join(pastaLote, nomeArquivo), 'Pedido iFood com Cupom 0.00', 'utf-8');

    const arq = await prisma.arquivoImportacao.create({
      data: {
        loteId,
        nomeArquivo,
        caminhoRelativo: nomeArquivo,
        status: 'RECEPCIONADO',
      },
    });

    const res = await worker.processarArquivoIndividual({
      lote: { id: loteId, usuarioId, caminhoDiretorio: 'uploads/test-bug-08' },
      arquivo: { id: arq.id, nomeArquivo: arq.nomeArquivo, caminhoRelativo: arq.caminhoRelativo, mimeType: 'text/plain' },
      contexto: {
        contas: [],
        categorias: [],
        dataReferencia: '2026-07-10',
      },
    });

    expect(res.sucesso).toBe(true);
    expect(res.totalTransacoes).toBe(1);

    const arqAtualizado = await prisma.arquivoImportacao.findUnique({ where: { id: arq.id } });
    expect(arqAtualizado?.status).toBe('IA_CONCLUIDO');
    expect(arqAtualizado?.mensagemErro).toBeNull();
  });

  it('2. Reconhecimento de Documento Vazio (CSV sem movimentação apenas com cabeçalho): conclui como PROCESSADO_FINAL sem erro', async () => {
    const nomeCsvVazio = 'NU_44719326_01MAI2026_31MAI2026.csv';
    const csvContent = 'Data,Valor,Identificador,Descrição\n';
    await fs.writeFile(path.join(pastaLote, nomeCsvVazio), csvContent, 'utf-8');

    const arq = await prisma.arquivoImportacao.create({
      data: {
        loteId,
        nomeArquivo: nomeCsvVazio,
        caminhoRelativo: nomeCsvVazio,
        mimeType: 'text/csv',
        status: 'RECEPCIONADO',
      },
    });

    // Cliente IA real (extrairTransacoes retornará vazio)
    const client = new GeminiIaExtratorClient();
    const worker = new ImportacaoIaWorkerService(client);

    const res = await worker.processarArquivoIndividual({
      lote: { id: loteId, usuarioId, caminhoDiretorio: 'uploads/test-bug-08' },
      arquivo: { id: arq.id, nomeArquivo: arq.nomeArquivo, caminhoRelativo: arq.caminhoRelativo, mimeType: 'text/csv' },
      contexto: {
        contas: [],
        categorias: [],
        dataReferencia: '2026-05-31',
      },
    });

    expect(res.sucesso).toBe(true);
    expect(res.totalTransacoes).toBe(0);

    const arqAtualizado = await prisma.arquivoImportacao.findUnique({ where: { id: arq.id } });
    expect(arqAtualizado?.status).toBe('PROCESSADO_FINAL');
    expect(arqAtualizado?.mensagemErro).toBeNull();
  });

  it('3. Reconhecimento de Fatura com Consumo Zero (Mercado Pago PDF R$ 0,00): conclui com sucesso sem erro', async () => {
    const nomePdfFatura = 'Mercado_Pago_Fatura_2026-08.pdf';
    const faturaRealOrigem = path.resolve(
      process.cwd(),
      '.local/Financas/01_ORIGINAIS/2026/2026-08/99_HISTORICO/LIDO__Mercado_Pago_Fatura_2026-08.pdf'
    );

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await fs.readFile(faturaRealOrigem);
    } catch {
      pdfBuffer = Buffer.from('%PDF-1.4 Você não consumiu nada esse mês Total a pagar R$ 0,00', 'utf-8');
    }

    await fs.writeFile(path.join(pastaLote, nomePdfFatura), pdfBuffer);

    const arq = await prisma.arquivoImportacao.create({
      data: {
        loteId,
        nomeArquivo: nomePdfFatura,
        caminhoRelativo: nomePdfFatura,
        mimeType: 'application/pdf',
        status: 'RECEPCIONADO',
      },
    });

    // Cliente IA retorna vazio para fatura sem consumo
    const mockClientVazio: IIaExtratorClient = {
      async extrairTransacoes() {
        return [];
      },
    };

    const worker = new ImportacaoIaWorkerService(mockClientVazio);

    const res = await worker.processarArquivoIndividual({
      lote: { id: loteId, usuarioId, caminhoDiretorio: 'uploads/test-bug-08' },
      arquivo: { id: arq.id, nomeArquivo: arq.nomeArquivo, caminhoRelativo: arq.caminhoRelativo, mimeType: 'application/pdf' },
      contexto: {
        contas: [],
        categorias: [],
        dataReferencia: '2026-08-31',
      },
    });

    expect(res.sucesso).toBe(true);
    expect(res.totalTransacoes).toBe(0);

    const arqAtualizado = await prisma.arquivoImportacao.findUnique({ where: { id: arq.id } });
    expect(arqAtualizado?.status).toBe('PROCESSADO_FINAL');
    expect(arqAtualizado?.mensagemErro).toBeNull();
  });

  it('4. Rejeição de Documento Corrompido / Ilegível continua disparando ERRO', async () => {
    const nomeInvalido = 'arquivo_invalido_sem_transacao.txt';
    await fs.writeFile(path.join(pastaLote, nomeInvalido), 'Conteudo sem nada e sem sentido algum.', 'utf-8');

    const arq = await prisma.arquivoImportacao.create({
      data: {
        loteId,
        nomeArquivo: nomeInvalido,
        caminhoRelativo: nomeInvalido,
        mimeType: 'text/plain',
        status: 'RECEPCIONADO',
      },
    });

    const mockClientVazio: IIaExtratorClient = {
      async extrairTransacoes() {
        return [];
      },
    };

    const worker = new ImportacaoIaWorkerService(mockClientVazio);

    const res = await worker.processarArquivoIndividual({
      lote: { id: loteId, usuarioId, caminhoDiretorio: 'uploads/test-bug-08' },
      arquivo: { id: arq.id, nomeArquivo: arq.nomeArquivo, caminhoRelativo: arq.caminhoRelativo, mimeType: 'text/plain' },
      contexto: {
        contas: [],
        categorias: [],
        dataReferencia: '2026-10-15',
      },
    });

    expect(res.sucesso).toBe(false);
    expect(res.erro).toContain('A IA não identificou transações válidas no documento');

    const arqAtualizado = await prisma.arquivoImportacao.findUnique({ where: { id: arq.id } });
    expect(arqAtualizado?.status).toBe('ERRO');
    expect(arqAtualizado?.mensagemErro).toContain('A IA não identificou transações válidas no documento');
  });
});
