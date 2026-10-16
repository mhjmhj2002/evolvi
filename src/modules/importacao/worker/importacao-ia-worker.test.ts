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

  describe('4. TASK-37: Seleção de IA e Reprocessamento Granular por Arquivo', () => {
    it('deve reprocessar individualmente um arquivo com erro usando uma IA diferente (ex: DEEPSEEK) e recuperar o lote', async () => {
      const lote = await storageService.recepcionarLote({
        usuarioId,
        arquivos: [
          {
            nomeOriginal: 'fatura_inter_erro.csv',
            buffer: Buffer.from('data,descricao,valor\n2026-10-10,Assinatura Streaming,49.90', 'utf-8'),
            mimeType: 'text/csv',
          },
        ],
      });
      pastasParaLimpeza.push(path.resolve(process.cwd(), lote.caminhoDiretorio));

      const arq = await prisma.arquivoImportacao.findFirst({
        where: { loteId: lote.loteId },
      });
      expect(arq).toBeDefined();

      // Força arquivo e lote em estado de ERRO prévio
      await prisma.arquivoImportacao.update({
        where: { id: arq!.id },
        data: {
          status: 'ERRO',
          mensagemErro: 'Quota excedida no Gemini (HTTP 429)',
        },
      });

      await prisma.loteImportacao.update({
        where: { id: lote.loteId },
        data: {
          status: 'ERRO_TOTAL',
          arquivosProcessados: 0,
        },
      });

      // Cadastra configuração da IA DEEPSEEK para o usuário de teste
      const { CryptoService } = await import('../../../infrastructure/security/crypto.service.js');
      const enc = CryptoService.encrypt('sk-deepseek-mock-test-key-12345678');
      await prisma.configuracaoIaUsuario.upsert({
        where: {
          usuarioId_provedor: {
            usuarioId,
            provedor: 'DEEPSEEK',
          },
        },
        create: {
          usuarioId,
          provedor: 'DEEPSEEK',
          modelo: 'deepseek-chat',
          apiKeyCifrada: enc.ciphertext,
          ivHex: enc.iv,
          tagHex: enc.tag,
        },
        update: {
          modelo: 'deepseek-chat',
          apiKeyCifrada: enc.ciphertext,
          ivHex: enc.iv,
          tagHex: enc.tag,
        },
      });

      // Mock de fetch para a chamada da API do DeepSeek
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: any, opts: any) => {
        if (typeof url === 'string' && url.includes('api.deepseek.com')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      transacoes: [
                        {
                          dataMovimento: '2026-10-10',
                          descricao: 'Assinatura Streaming Recuperada',
                          valor: 49.9,
                          natureza: 'DESPESA',
                          contaSugerida: 'Nubank Cartão',
                          tipoConta: 'CARTAO_CREDITO',
                          categoriaSugerida: 'Outros',
                          isPagamentoFatura: false,
                          confianca: 0.99,
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
            text: async () => '',
          } as any;
        }
        return originalFetch(url, opts);
      });

      // Dispara reprocessamento individual do arquivo via rota HTTP com DEEPSEEK
      const res = await app.inject({
        method: 'POST',
        url: `/api/importacao/arquivos/${arq!.id}/reprocessar-ia`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          provedorIa: 'DEEPSEEK',
          modeloIa: 'deepseek-chat',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.resultado.sucesso).toBe(true);
      expect(body.resultado.arquivoId).toBe(arq!.id);
      expect(body.resultado.totalTransacoes).toBeGreaterThan(0);

      // Valida que o arquivo foi para IA_CONCLUIDO e a mensagem de erro foi limpa
      const arqAtualizado = await prisma.arquivoImportacao.findUnique({
        where: { id: arq!.id },
      });
      expect(arqAtualizado?.status).toBe('IA_CONCLUIDO');
      expect(arqAtualizado?.mensagemErro).toBeNull();

      // Valida que o lote foi restaurado de ERRO_TOTAL para PROCESSANDO_IA (pronto para seguir fluxo de staging/conciliação)
      const loteAtualizado = await prisma.loteImportacao.findUnique({
        where: { id: lote.loteId },
      });
      expect(loteAtualizado?.status).toBe('PROCESSANDO_IA');
      expect(loteAtualizado?.arquivosProcessados).toBe(1);

      // Valida que o arquivo físico consolidado foi gerado com sucesso
      const consolidadoPath = path.resolve(
        process.cwd(),
        lote.caminhoDiretorio,
        `consolidado_${arq!.id}.json`
      );
      const consolidadoConteudo = await fs.readFile(consolidadoPath, 'utf-8');
      const consolidadoJson = JSON.parse(consolidadoConteudo);
      expect(consolidadoJson.metadados.provedor).toBe('DEEPSEEK');
      expect(consolidadoJson.metadados.modelo).toBe('deepseek-chat');

      // Restaura fetch
      globalThis.fetch = originalFetch;
    });

    it('deve bloquear usuário não proprietário de reprocessar arquivo de outro usuário (Multi-Tenant HTTP 404)', async () => {
      const loteUsuario1 = await storageService.recepcionarLote({
        usuarioId,
        arquivos: [
          {
            nomeOriginal: 'arquivo_privado.csv',
            buffer: Buffer.from('data,descricao,valor\n2026-10-10,Privado,99.00', 'utf-8'),
            mimeType: 'text/csv',
          },
        ],
      });
      pastasParaLimpeza.push(path.resolve(process.cwd(), loteUsuario1.caminhoDiretorio));

      const arq = await prisma.arquivoImportacao.findFirst({
        where: { loteId: loteUsuario1.loteId },
      });
      expect(arq).toBeDefined();

      // Usuário 2 tenta reprocessar arquivo que pertence ao Usuário 1
      const res = await app.inject({
        method: 'POST',
        url: `/api/importacao/arquivos/${arq!.id}/reprocessar-ia`,
        headers: {
          authorization: `Bearer ${token2}`,
        },
        payload: {
          provedorIa: 'DEEPSEEK',
        },
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.message).toContain('não encontrado ou não pertence ao usuário');
    });

    it('deve rejeitar UUID inválido com HTTP 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/importacao/arquivos/uuid-invalido/reprocessar-ia',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          provedorIa: 'GEMINI',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.message).toBe('ID do arquivo inválido.');
    });
  });

  describe('5. TASK-38: Descarte Inteligente de Mídia Incompatível e Limpeza de Erros no Reprocessamento', () => {
    it('deve descartar arquivos de imagem enviados com DeepSeek sem chamar API externa e com mensagem explicativa', async () => {
      // Cria lote com arquivo de imagem (.png)
      const lote = await storageService.recepcionarLote({
        usuarioId,
        arquivos: [
          {
            nomeOriginal: 'comprovante_pix.png',
            buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            mimeType: 'image/png',
          },
        ],
      });
      pastasParaLimpeza.push(path.resolve(process.cwd(), lote.caminhoDiretorio));

      // Mock do fetch para assegurar que NENHUMA chamada externa é feita
      const fetchSpy = vi.fn();
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchSpy as any;

      try {
        const workerService = new ImportacaoIaWorkerService(undefined, process.cwd(), false);
        const resultadoLote = await workerService.processarLote(lote.loteId, {
          provedorIa: 'DEEPSEEK',
          modeloIa: 'deepseek-chat',
        });

        // Não deve ter disparado fetch para o DeepSeek
        expect(fetchSpy).not.toHaveBeenCalled();

        // O arquivo deve ter sido registrado com erro explicativo
        expect(resultadoLote.arquivosComErro).toBe(1);
        const arq = await prisma.arquivoImportacao.findFirst({
          where: { loteId: lote.loteId },
        });

        expect(arq?.status).toBe('ERRO');
        expect(arq?.mensagemErro).toContain('não oferece suporte a imagens (.jpg/.png)');
        expect(arq?.mensagemErro).toContain('Reprocesse individualmente selecionando o Google Gemini');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('deve limpar imediatamente a mensagem de erro anterior ao iniciar o reprocessamento de arquivo', async () => {
      // 1. Cria lote e arquivo já marcado com erro
      const lote = await storageService.recepcionarLote({
        usuarioId,
        arquivos: [
          {
            nomeOriginal: 'fatura_antiga_falha.csv',
            buffer: Buffer.from('data,descricao,valor\n2026-10-10,Item Teste,15.00', 'utf-8'),
            mimeType: 'text/csv',
          },
        ],
      });
      pastasParaLimpeza.push(path.resolve(process.cwd(), lote.caminhoDiretorio));

      const arq = await prisma.arquivoImportacao.findFirst({
        where: { loteId: lote.loteId },
      });
      expect(arq).toBeDefined();

      // Força erro prévio no arquivo
      await prisma.arquivoImportacao.update({
        where: { id: arq!.id },
        data: {
          status: 'ERRO',
          mensagemErro: 'Erro crítico anterior simulado de rede ou timeout.',
        },
      });

      // 2. Mock do extrator para simular sucesso no reprocessamento
      const mockExtrator: IIaExtratorClient = {
        extrairTransacoes: vi.fn().mockResolvedValue([
          {
            dataMovimento: '2026-10-10',
            descricao: 'Item Teste Recuperado',
            valor: 15.0,
            natureza: 'DESPESA',
            contaSugerida: 'Nubank Cartão',
            tipoConta: 'CARTAO_CREDITO',
            categoriaSugerida: 'Alimentação',
            parcelaAtual: null,
            totalParcelas: null,
            isPagamentoFatura: false,
            observacao: 'Recuperado com sucesso',
            confianca: 0.99,
          },
        ]),
      };

      const workerService = new ImportacaoIaWorkerService(mockExtrator, process.cwd(), false);

      // 3. Executa reprocessamento
      const resultado = await workerService.reprocessarArquivoIndividualComIa({
        arquivoId: arq!.id,
        usuarioId,
        provedorIa: 'GEMINI',
      });

      expect(resultado.sucesso).toBe(true);
      expect(resultado.totalTransacoes).toBe(1);

      // 4. Valida que a mensagem de erro foi completamente limpa
      const arqAtualizado = await prisma.arquivoImportacao.findUnique({
        where: { id: arq!.id },
      });
      expect(arqAtualizado?.status).toBe('IA_CONCLUIDO');
      expect(arqAtualizado?.mensagemErro).toBeNull();
    });
  });
});
