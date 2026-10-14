import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import { buildApp } from '../../../app.js';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { ImportacaoStorageService } from '../importacao-storage.service.js';
import {
  ImportacaoIaWorkerService,
} from './importacao-ia-worker.service.js';
import {
  importacaoEventBus,
  ImportacaoArquivoProgressoEvent,
  ImportacaoArquivoConsolidadoProntoEvent,
} from '../../../infrastructure/events/importacao-event-bus.js';
import { IIaExtratorClient, GeminiIaExtratorClient } from './ia-extrator.client.js';
import { LancamentoConsolidadoIa, arquivoConsolidadoIaSchema } from './ia-extrator.schema.js';

describe('TASK-33: Worker 1 de Extração Sequencial com IA e Geração de Arquivo Consolidado (IMP-WRK-IA)', () => {
  let app: FastifyInstance;
  let usuarioId: string;
  let token: string;
  let usuario2Id: string;
  let token2: string;
  const storageService = new ImportacaoStorageService();
  const pastasParaLimpeza: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Cria Usuário 1 com contas e categorias
    const email1 = `user1-wrk-ia-${Date.now()}@evolvi.app`;
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario IA Teste',
        email: email1,
        senha: 'SenhaForte123!',
      },
    });
    const body1 = JSON.parse(res1.body);
    usuarioId = body1.usuario.id;
    token = body1.token;

    // Cria Conta bancária para contexto
    await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Nubank Cartão',
        tipo: 'CARTAO_CREDITO',
      },
    });

    // Cria Usuário 2 para teste multi-tenant
    const email2 = `user2-wrk-ia-${Date.now()}@evolvi.app`;
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario 2 Isolamento',
        email: email2,
        senha: 'SenhaForte123!',
      },
    });
    const body2 = JSON.parse(res2.body);
    usuario2Id = body2.usuario.id;
    token2 = body2.token;
  });

  afterAll(async () => {
    if (usuarioId || usuario2Id) {
      await prisma.stagingLancamentoImportacao.deleteMany({
        where: { lote: { usuarioId: { in: [usuarioId, usuario2Id] } } },
      });
      await prisma.arquivoImportacao.deleteMany({
        where: { lote: { usuarioId: { in: [usuarioId, usuario2Id] } } },
      });
      await prisma.loteImportacao.deleteMany({
        where: { usuarioId: { in: [usuarioId, usuario2Id] } },
      });
      await prisma.conta.deleteMany({
        where: { usuarioId: { in: [usuarioId, usuario2Id] } },
      });
      await prisma.usuario.deleteMany({
        where: { id: { in: [usuarioId, usuario2Id] } },
      });
    }

    for (const pasta of pastasParaLimpeza) {
      try {
        await fs.rm(pasta, { recursive: true, force: true });
      } catch {
        // Ignora
      }
    }
  });

  describe('1. Validação de Schemas e Mock de Extração de IA', () => {
    it('deve validar um arquivo consolidado com o schema Zod oficial', () => {
      const payload = {
        loteId: '8f754707-88df-4654-bf6e-9caea6ebbbbe',
        arquivoId: 'b78a9463-7036-40f4-8a40-33ca74687d0e',
        nomeArquivoOrigem: 'fatura_outubro_nubank.pdf',
        totalTransacoes: 2,
        geradoEm: new Date().toISOString(),
        metadados: {
          provedor: 'GEMINI',
          modelo: 'gemini-2.5-flash',
          tentativas: 1,
        },
        transacoes: [
          {
            dataMovimento: '2026-10-15',
            descricao: 'Supermercado Pão de Açúcar',
            valor: 145.9,
            natureza: 'DESPESA',
            contaSugerida: 'Nubank Cartão',
            tipoConta: 'CARTAO_CREDITO',
            categoriaSugerida: 'Alimentação',
            parcelaAtual: null,
            totalParcelas: null,
            isPagamentoFatura: false,
            observacao: null,
            confianca: 0.99,
          },
          {
            dataMovimento: '2026-10-16',
            descricao: 'Pagamento de Fatura',
            valor: 1500.0,
            natureza: 'TRANSFERENCIA_PROPRIA',
            contaSugerida: 'Itaú Corrente',
            tipoConta: 'CONTA_CORRENTE',
            categoriaSugerida: null,
            parcelaAtual: null,
            totalParcelas: null,
            isPagamentoFatura: true,
            observacao: 'Anti-dupla contagem ativada',
            confianca: 1.0,
          },
        ],
      };

      const resultado = arquivoConsolidadoIaSchema.safeParse(payload);
      expect(resultado.success).toBe(true);
      if (resultado.success) {
        expect(resultado.data.transacoes.length).toBe(2);
        expect(resultado.data.transacoes[1].isPagamentoFatura).toBe(true);
        expect(resultado.data.transacoes[1].natureza).toBe('TRANSFERENCIA_PROPRIA');
      }
    });

    it('deve extrair transações via motor heurístico/determinístico local com categorização e anti-dupla contagem', async () => {
      const client = new GeminiIaExtratorClient();
      const csvTexto = `Data;Descrição;Valor\n10/10/2026;Restaurante Almoço;45,50\n11/10/2026;Pagamento de Fatura Nubank;-800,00\n12/10/2026;Salário Empresa;5000,00`;

      const transacoes = await client.extrairTransacoes({
        nomeArquivo: 'extrato_outubro.csv',
        conteudoBuffer: Buffer.from(csvTexto, 'utf-8'),
        contexto: {
          contas: [{ id: '1', nome: 'Nubank', tipo: 'CARTAO_CREDITO' }],
          categorias: [{ id: '1', nome: 'Alimentação' }],
          dataReferencia: '2026-10-13',
        },
      });

      expect(transacoes.length).toBe(3);
      expect(transacoes[0].descricao).toContain('Restaurante');
      expect(transacoes[0].valor).toBe(45.5);
      expect(transacoes[0].natureza).toBe('DESPESA');

      // Anti-dupla contagem de fatura
      expect(transacoes[1].isPagamentoFatura).toBe(true);
      expect(transacoes[1].natureza).toBe('TRANSFERENCIA_PROPRIA');
      expect(transacoes[1].valor).toBe(800.0);

      // Receita
      expect(transacoes[2].natureza).toBe('RECEITA');
      expect(transacoes[2].valor).toBe(5000.0);
    });
  });

  describe('2. Processamento Sequencial (1 Arquivo por Vez) e Geração de Arquivo Consolidado', () => {
    it('deve processar rigorosamente 1 arquivo por vez em lote e gerar o arquivo JSON consolidado físico na pasta', async () => {
      // 1. Cria um lote com 2 arquivos para simular lote sequencial
      const arq1Conteudo = `10/10/2026 Lanche Tarde R$ 25,00\n11/10/2026 Uber Viagem R$ 32,50`;
      const arq2Conteudo = `12/10/2026 Mercado Central R$ 115,00\n13/10/2026 Farmácia Popular R$ 48,00`;

      const loteCriado = await storageService.recepcionarLote({
        usuarioId,
        arquivos: [
          {
            nomeOriginal: 'comprovantes_dia1.txt',
            buffer: Buffer.from(arq1Conteudo, 'utf-8'),
            mimeType: 'text/plain',
          },
          {
            nomeOriginal: 'comprovantes_dia2.txt',
            buffer: Buffer.from(arq2Conteudo, 'utf-8'),
            mimeType: 'text/plain',
          },
        ],
      });

      pastasParaLimpeza.push(path.resolve(process.cwd(), loteCriado.caminhoDiretorio));

      // Mock client que rastreia ordem de execução sequencial
      const ordemExecucao: string[] = [];
      const mockClient: IIaExtratorClient = {
        async extrairTransacoes(params) {
          ordemExecucao.push(params.nomeArquivo);
          // Simula latência assíncrona
          await new Promise((res) => setTimeout(res, 30));

          return [
            {
              dataMovimento: '2026-10-10',
              descricao: `Compra em ${params.nomeArquivo}`,
              valor: 50.0,
              natureza: 'DESPESA',
              contaSugerida: 'Nubank Cartão',
              tipoConta: 'CARTAO_CREDITO',
              categoriaSugerida: 'Outros',
              parcelaAtual: null,
              totalParcelas: null,
              isPagamentoFatura: false,
              observacao: 'Processado por Mock',
              confianca: 1.0,
            },
          ];
        },
      };

      // Rastrear eventos emitidos
      const eventosProgresso: ImportacaoArquivoProgressoEvent[] = [];
      const eventosConsolidados: ImportacaoArquivoConsolidadoProntoEvent[] = [];

      const unsubProgresso = (e: ImportacaoArquivoProgressoEvent) => eventosProgresso.push(e);
      const unsubConsolidado = (e: ImportacaoArquivoConsolidadoProntoEvent) => eventosConsolidados.push(e);

      importacaoEventBus.onArquivoProgresso(unsubProgresso);
      importacaoEventBus.onArquivoConsolidadoPronto(unsubConsolidado);

      const worker = new ImportacaoIaWorkerService(mockClient);
      const resultadoLote = await worker.processarLote(loteCriado.loteId);

      // Verificações do resultado
      expect(resultadoLote.totalArquivos).toBe(2);
      expect(resultadoLote.arquivosProcessadosComSucesso).toBe(2);
      expect(resultadoLote.arquivosComErro).toBe(0);

      // Verificação da ordem sequencial (1 por vez)
      expect(ordemExecucao).toEqual(['comprovantes_dia1.txt', 'comprovantes_dia2.txt']);

      // Verifica status atualizado no banco
      const loteNoBanco = await prisma.loteImportacao.findUnique({
        where: { id: loteCriado.loteId },
        include: { arquivos: true },
      });

      expect(loteNoBanco?.arquivosProcessados).toBe(2);
      expect(loteNoBanco?.arquivos.length).toBe(2);
      expect(loteNoBanco?.arquivos.every((a) => a.status === 'IA_CONCLUIDO')).toBe(true);

      // Verifica existência física do arquivo consolidado para cada arquivo
      for (const arq of loteNoBanco!.arquivos) {
        const caminhoEsperado = path.resolve(
          process.cwd(),
          loteCriado.caminhoDiretorio,
          `consolidado_${arq.id}.json`
        );
        const existe = await fs
          .access(caminhoEsperado)
          .then(() => true)
          .catch(() => false);
        expect(existe).toBe(true);

        const conteudoJson = JSON.parse(await fs.readFile(caminhoEsperado, 'utf-8'));
        expect(conteudoJson.arquivoId).toBe(arq.id);
        expect(conteudoJson.loteId).toBe(loteCriado.loteId);
        expect(conteudoJson.transacoes.length).toBeGreaterThan(0);
      }

      // Verifica eventos emitidos
      expect(eventosProgresso.some((e) => e.status === 'ENVIADO_IA')).toBe(true);
      expect(eventosProgresso.some((e) => e.status === 'IA_CONCLUIDO')).toBe(true);
      expect(eventosConsolidados.length).toBe(2);
      expect(eventosConsolidados[0].usuarioId).toBe(usuarioId);
    });

    it('deve lidar com falha de validação ou erro de extração registrando status ERRO de forma resiliente', async () => {
      const loteFalha = await storageService.recepcionarLote({
        usuarioId,
        arquivos: [
          {
            nomeOriginal: 'arquivo_corrompido.pdf',
            buffer: Buffer.from('conteudo corrompido sem dados', 'utf-8'),
            mimeType: 'application/pdf',
          },
        ],
      });
      pastasParaLimpeza.push(path.resolve(process.cwd(), loteFalha.caminhoDiretorio));

      // Mock que retorna lista vazia simulando erro da IA
      const mockFalha: IIaExtratorClient = {
        async extrairTransacoes() {
          return []; // Sem transações válidas
        },
      };

      const worker = new ImportacaoIaWorkerService(mockFalha);
      const resultado = await worker.processarLote(loteFalha.loteId);

      expect(resultado.arquivosComErro).toBe(1);
      expect(resultado.arquivosProcessadosComSucesso).toBe(0);

      const arqBanco = await prisma.arquivoImportacao.findFirst({
        where: { loteId: loteFalha.loteId },
      });
      expect(arqBanco?.status).toBe('ERRO');
      expect(arqBanco?.mensagemErro).toContain('A IA não identificou transações válidas');

      const loteBanco = await prisma.loteImportacao.findUnique({
        where: { id: loteFalha.loteId },
      });
      expect(loteBanco?.status).toBe('ERRO_TOTAL');
    });
  });

  describe('3. Rota HTTP de Processamento Manual e Isolamento Multi-Tenant', () => {
    it('deve disparar o processamento do lote via endpoint POST /api/importacao/lotes/:id/processar-ia', async () => {
      const lote = await storageService.recepcionarLote({
        usuarioId,
        arquivos: [
          {
            nomeOriginal: 'fatura_manual.csv',
            buffer: Buffer.from('Data;Descricao;Valor\n15/10/2026;Aluguel Apartamento;1200,00', 'utf-8'),
            mimeType: 'text/csv',
          },
        ],
      });
      pastasParaLimpeza.push(path.resolve(process.cwd(), lote.caminhoDiretorio));

      const res = await app.inject({
        method: 'POST',
        url: `/api/importacao/lotes/${lote.loteId}/processar-ia`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.resultado.loteId).toBe(lote.loteId);
      expect(body.resultado.arquivosProcessadosComSucesso).toBe(1);

      // Confirma arquivo consolidado gerado
      const arq = await prisma.arquivoImportacao.findFirst({ where: { loteId: lote.loteId } });
      expect(arq?.status).toBe('IA_CONCLUIDO');
    });

    it('deve bloquear usuário não proprietário de processar lote alheio (Multi-Tenant HTTP 404)', async () => {
      const loteUsuario1 = await storageService.recepcionarLote({
        usuarioId,
        arquivos: [
          {
            nomeOriginal: 'secreto.txt',
            buffer: Buffer.from('10/10/2026 Secreto R$ 100,00', 'utf-8'),
            mimeType: 'text/plain',
          },
        ],
      });
      pastasParaLimpeza.push(path.resolve(process.cwd(), loteUsuario1.caminhoDiretorio));

      // Usuário 2 tenta disparar processamento do lote do Usuário 1
      const res = await app.inject({
        method: 'POST',
        url: `/api/importacao/lotes/${loteUsuario1.loteId}/processar-ia`,
        headers: {
          authorization: `Bearer ${token2}`,
        },
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.message).toContain('Lote de importação não encontrado');
    });
  });
});
