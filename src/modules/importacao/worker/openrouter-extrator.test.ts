import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import { buildApp } from '../../../app.js';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { CryptoService } from '../../../infrastructure/security/crypto.service.js';
import { ImportacaoStorageService } from '../importacao-storage.service.js';
import { ImportacaoIaWorkerService } from './importacao-ia-worker.service.js';
import { GeminiIaExtratorClient } from './ia-extrator.client.js';
import { MODELO_OPENROUTER_PADRAO, obterConfigOpenRouter } from '../../ia/openrouter.config.js';

/**
 * Extrator de importação com provedor OPENROUTER (fetch mockado, sem rede real).
 *
 * Cobre: transações normalizadas, consolidado com metadados.provedor OPENROUTER,
 * vínculo com `uso_ia_logs` e isolamento multi-tenant da configuração.
 */
describe('OPENROUTER: extração de transações pelo worker de importação', () => {
  let app: FastifyInstance;
  let usuarioAId: string;
  let tokenA: string;
  let usuarioBId: string;
  let tokenB: string;

  const storageService = new ImportacaoStorageService();
  const pastasParaLimpeza: string[] = [];
  const config = obterConfigOpenRouter();

  const contexto = {
    contas: [{ id: 'c1', nome: 'Nubank Cartão', tipo: 'CARTAO_CREDITO' }],
    categorias: [{ id: 'cat1', nome: 'Alimentação' }],
    dataReferencia: '2026-10-21',
  };

  const respostaOpenRouter = (payload: unknown) => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(payload) } }],
      usage: { prompt_tokens: 900, completion_tokens: 150, total_tokens: 1050 },
    }),
    text: async () => '',
  });

  async function criarConfig(usuarioId: string, modelo = MODELO_OPENROUTER_PADRAO) {
    const enc = CryptoService.encrypt(`sk-or-v1-${usuarioId.slice(0, 8)}-token`);
    await prisma.configuracaoIaUsuario.upsert({
      where: { usuarioId_provedor: { usuarioId, provedor: 'OPENROUTER' } },
      create: {
        usuarioId,
        provedor: 'OPENROUTER',
        modelo,
        apiKeyCifrada: enc.ciphertext,
        ivHex: enc.iv,
        tagHex: enc.tag,
      },
      update: {
        modelo,
        apiKeyCifrada: enc.ciphertext,
        ivHex: enc.iv,
        tagHex: enc.tag,
      },
    });
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const resA = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuário A OpenRouter',
        email: `openrouter-a-${Date.now()}@evolvi.app`,
        senha: 'SenhaForte123!',
      },
    });
    const bodyA = JSON.parse(resA.body);
    usuarioAId = bodyA.usuario.id;
    tokenA = bodyA.token;

    const resB = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuário B OpenRouter',
        email: `openrouter-b-${Date.now()}@evolvi.app`,
        senha: 'SenhaForte123!',
      },
    });
    const bodyB = JSON.parse(resB.body);
    usuarioBId = bodyB.usuario.id;
    tokenB = bodyB.token;
  });

  afterAll(async () => {
    if (usuarioAId || usuarioBId) {
      await prisma.usoIaLog.deleteMany({
        where: { usuarioId: { in: [usuarioAId, usuarioBId] } },
      });
      await prisma.configuracaoIaUsuario.deleteMany({
        where: { usuarioId: { in: [usuarioAId, usuarioBId] } },
      });
      await prisma.stagingLancamentoImportacao.deleteMany({
        where: { lote: { usuarioId: { in: [usuarioAId, usuarioBId] } } },
      });
      await prisma.arquivoImportacao.deleteMany({
        where: { lote: { usuarioId: { in: [usuarioAId, usuarioBId] } } },
      });
      await prisma.loteImportacao.deleteMany({
        where: { usuarioId: { in: [usuarioAId, usuarioBId] } },
      });
      await prisma.conta.deleteMany({
        where: { usuarioId: { in: [usuarioAId, usuarioBId] } },
      });
      await prisma.usuario.deleteMany({
        where: { id: { in: [usuarioAId, usuarioBId] } },
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

  it('extrairTransacoes deve normalizar transações, gravar uso_ia_logs e usar apenas a chave do próprio usuário', async () => {
    await criarConfig(usuarioAId);
    // Configuração de OUTRO usuário (não pode vazar para a extração do usuário A)
    await criarConfig(usuarioBId);

    const client = new GeminiIaExtratorClient('');
    const fetchMock = vi.fn().mockResolvedValue(
      respostaOpenRouter({
        transacoes: [
          {
            dataMovimento: '2026-10-20',
            descricao: 'Almoço Restaurante OpenRouter',
            valor: 78.9,
            natureza: 'DESPESA',
            contaSugerida: 'Nubank Cartão',
            tipoConta: 'CARTAO_CREDITO',
            categoriaSugerida: 'Alimentação',
            isPagamentoFatura: false,
            confianca: 0.98,
          },
          {
            dataMovimento: '2026-10-21',
            descricao: 'Pagamento de Fatura Nubank',
            valor: 1200,
            natureza: 'TRANSFERENCIA_PROPRIA',
            isPagamentoFatura: true,
            confianca: 0.99,
          },
        ],
      }) as any
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;

    const antes = await prisma.usoIaLog.count({ where: { usuarioId: usuarioAId } });

    let transacoes;
    try {
      transacoes = await client.extrairTransacoes({
        nomeArquivo: 'documento_livre_openrouter.txt',
        mimeType: 'text/plain',
        conteudoBuffer: Buffer.from('Documento financeiro não estruturado com dois lançamentos', 'utf-8'),
        usuarioId: usuarioAId,
        provedorIa: 'OPENROUTER',
        modeloIa: MODELO_OPENROUTER_PADRAO,
        contexto,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(transacoes).toHaveLength(2);
    expect(transacoes[0].descricao).toBe('Almoço Restaurante OpenRouter');
    expect(transacoes[0].valor).toBe(78.9);
    expect(transacoes[0].natureza).toBe('DESPESA');
    expect(transacoes[1].isPagamentoFatura).toBe(true);
    expect(transacoes[1].natureza).toBe('TRANSFERENCIA_PROPRIA');

    // URL + headers vindos do ambiente e chave do usuário A (isolamento multi-tenant)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${config.baseUrl}/chat/completions`);
    expect(opts.headers['HTTP-Referer']).toBe(config.httpReferer);
    expect(opts.headers['X-Title']).toBe(config.xTitle);
    const chaveEsperada = CryptoService.decrypt(
      await prisma.configuracaoIaUsuario
        .findUnique({
          where: { usuarioId_provedor: { usuarioId: usuarioAId, provedor: 'OPENROUTER' } },
        })
        .then((cfg) => ({
          ciphertext: cfg!.apiKeyCifrada,
          iv: cfg!.ivHex,
          tag: cfg!.tagHex,
        }))
    );
    expect(opts.headers.Authorization).toBe(`Bearer ${chaveEsperada}`);
    expect(opts.headers.Authorization).not.toBe(
      `Bearer sk-or-v1-${usuarioBId.slice(0, 8)}-token`
    );

    // Body OpenAI-compatible com modelo vendor/model
    const body = JSON.parse(opts.body);
    expect(body.model).toBe(MODELO_OPENROUTER_PADRAO);
    expect(body.model).toContain('/');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(typeof body.messages[1].content).toBe('string');

    // Telemetria: exatamente 1 log vinculado ao provedor OPENROUTER
    const depois = await prisma.usoIaLog.count({ where: { usuarioId: usuarioAId } });
    expect(depois - antes).toBe(1);

    const log = await prisma.usoIaLog.findFirst({
      where: { usuarioId: usuarioAId, funcionalidade: 'EXTRACAO_EXTRATO' },
      orderBy: { criadoEm: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log!.provedor).toBe('OPENROUTER');
    expect(log!.modelo).toBe(MODELO_OPENROUTER_PADRAO);
    expect(log!.status).toBe('SUCESSO');
    expect(log!.tokensTotal).toBe(1050);

    // Nenhum log gerado para o usuário B
    const logsB = await prisma.usoIaLog.count({ where: { usuarioId: usuarioBId } });
    expect(logsB).toBe(0);
  });

  it('processarLote deve gravar consolidado com metadados.provedor OPENROUTER e log vinculado ao arquivo', async () => {
    await criarConfig(usuarioAId);

    const lote = await storageService.recepcionarLote({
      usuarioId: usuarioAId,
      arquivos: [
        {
          nomeOriginal: 'documento_livre_worker_openrouter.txt',
          buffer: Buffer.from('Comprovante livre sem colunas 2026-10-21 Padaria 22,40', 'utf-8'),
          mimeType: 'text/plain',
        },
      ],
    });
    pastasParaLimpeza.push(path.resolve(process.cwd(), lote.caminhoDiretorio));

    const arquivo = await prisma.arquivoImportacao.findFirst({
      where: { loteId: lote.loteId },
    });
    expect(arquivo).toBeDefined();

    const fetchMock = vi.fn().mockResolvedValue(
      respostaOpenRouter({
        transacoes: [
          {
            dataMovimento: '2026-10-21',
            descricao: 'Padaria Pão Quente',
            valor: 22.4,
            natureza: 'DESPESA',
            categoriaSugerida: 'Alimentação',
            isPagamentoFatura: false,
            confianca: 0.97,
          },
        ],
      }) as any
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;

    let resultadoLote;
    try {
      const worker = new ImportacaoIaWorkerService(undefined, process.cwd(), false);
      resultadoLote = await worker.processarLote(lote.loteId, {
        provedorIa: 'OPENROUTER',
        modeloIa: MODELO_OPENROUTER_PADRAO,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(resultadoLote.arquivosProcessadosComSucesso).toBe(1);
    expect(resultadoLote.arquivosComErro).toBe(0);

    // Consolidado físico com metadados do provedor correto
    const caminhoConsolidado = path.resolve(
      process.cwd(),
      lote.caminhoDiretorio,
      `consolidado_${arquivo!.id}.json`
    );
    const consolidado = JSON.parse(await fs.readFile(caminhoConsolidado, 'utf-8'));
    expect(consolidado.metadados.provedor).toBe('OPENROUTER');
    expect(consolidado.metadados.modelo).toBe(MODELO_OPENROUTER_PADRAO);
    expect(consolidado.transacoes).toHaveLength(1);
    expect(consolidado.transacoes[0].descricao).toBe('Padaria Pão Quente');

    // uso_ia_logs vinculado ao lote e ao arquivo
    const log = await prisma.usoIaLog.findFirst({
      where: { usuarioId: usuarioAId, arquivoId: arquivo!.id },
      orderBy: { criadoEm: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log!.provedor).toBe('OPENROUTER');
    expect(log!.loteId).toBe(lote.loteId);
    expect(log!.status).toBe('SUCESSO');

    const arquivoAtualizado = await prisma.arquivoImportacao.findUnique({
      where: { id: arquivo!.id },
    });
    expect(arquivoAtualizado?.status).toBe('IA_CONCLUIDO');
  });

  it('imagem com provedorIa OPENROUTER deve gerar content multimodal (image_url), nunca binário como texto', async () => {
    await criarConfig(usuarioAId);

    const client = new GeminiIaExtratorClient('');
    const fetchMock = vi.fn().mockResolvedValue(
      respostaOpenRouter({
        transacoes: [
          {
            dataMovimento: '2026-10-21',
            descricao: 'Comprovante PIX recebido',
            valor: 150,
            natureza: 'RECEITA',
            isPagamentoFatura: false,
            confianca: 0.93,
          },
        ],
      }) as any
    );

    // Bytes de PNG (assinatura válida) — binário que NUNCA pode ir como string UTF-8
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;

    let transacoes;
    try {
      transacoes = await client.extrairTransacoes({
        nomeArquivo: 'comprovante_pix.png',
        mimeType: 'image/png',
        conteudoBuffer: pngBuffer,
        usuarioId: usuarioAId,
        provedorIa: 'OPENROUTER',
        modeloIa: MODELO_OPENROUTER_PADRAO,
        contexto,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(transacoes).toHaveLength(1);
    expect(transacoes[0].descricao).toBe('Comprovante PIX recebido');
    expect(transacoes[0].natureza).toBe('RECEITA');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);

    // content do usuário é um ARRAY multimodal
    const conteudoUsuario = body.messages[1].content;
    expect(Array.isArray(conteudoUsuario)).toBe(true);
    expect(conteudoUsuario[0].type).toBe('text');
    expect(typeof conteudoUsuario[0].text).toBe('string');

    const parteImagem = conteudoUsuario.find((p: any) => p.type === 'image_url');
    expect(parteImagem).toBeDefined();
    expect(parteImagem.image_url.url.startsWith('data:image/png;base64,')).toBe(true);
    expect(parteImagem.image_url.url).toContain(pngBuffer.toString('base64'));

    // Nenhuma parte do payload contém o binário decodificado como texto
    const serializado = JSON.stringify(body);
    expect(serializado).not.toContain(pngBuffer.toString('latin1'));
    expect(serializado).not.toContain('\uFFFD');
  });

  it('OPENAI no extrator deve falhar explicitamente (sem fallback silencioso para Gemini)', async () => {
    const client = new GeminiIaExtratorClient('sk-proj-chave-gemini-fallback-1234567890');
    const fetchMock = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;

    try {
      await expect(
        client.extrairTransacoes({
          nomeArquivo: 'documento_livre_openai.txt',
          mimeType: 'text/plain',
          conteudoBuffer: Buffer.from('Documento livre qualquer 10,00', 'utf-8'),
          usuarioId: usuarioAId,
          provedorIa: 'OPENAI',
          contexto,
        })
      ).rejects.toThrow('OPENAI ainda não suportado neste fluxo, use GEMINI, DEEPSEEK ou OPENROUTER');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
