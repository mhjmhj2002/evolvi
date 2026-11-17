import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { env } from '../../config/env.js';
import { importacaoDiagnosticoService } from './importacao-diagnostico.service.js';
import { ImportacaoStorageService } from './importacao-storage.service.js';
import {
  importacaoEventBus,
  ImportacaoEventBus,
  ImportacaoLoteRecepcionadoEvent,
} from '../../infrastructure/events/importacao-event-bus.js';

const execFileAsync = promisify(execFile);

describe('TASK-32: Modelagem e Armazenamento Temporário de Upload em Lote (IMP-STORAGE)', () => {
  let app: FastifyInstance;
  let usuario1Id: string;
  let token1: string;
  let usuario2Id: string;
  let token2: string;
  const storageService = new ImportacaoStorageService();
  const pastasCriadasParaLimpeza: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Usuário 1
    const email1 = `user1-imp-${Date.now()}@evolvi.app`;
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario 1 Importacao',
        email: email1,
        senha: 'SenhaForte123!',
      },
    });
    const body1 = JSON.parse(res1.body);
    usuario1Id = body1.usuario.id;
    token1 = body1.token;

    // Usuário 2 (Multi-tenant)
    const email2 = `user2-imp-${Date.now()}@evolvi.app`;
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario 2 Importacao',
        email: email2,
        senha: 'SenhaForte123!',
      },
    });
    const body2 = JSON.parse(res2.body);
    usuario2Id = body2.usuario.id;
    token2 = body2.token;
  });

  afterAll(async () => {
    // Limpeza de registros no banco
    if (usuario1Id || usuario2Id) {
      await prisma.stagingLancamentoImportacao.deleteMany({
        where: { lote: { usuarioId: { in: [usuario1Id, usuario2Id] } } },
      });
      await prisma.arquivoImportacao.deleteMany({
        where: { lote: { usuarioId: { in: [usuario1Id, usuario2Id] } } },
      });
      await prisma.loteImportacao.deleteMany({
        where: { usuarioId: { in: [usuario1Id, usuario2Id] } },
      });
      await prisma.usuario.deleteMany({
        where: { id: { in: [usuario1Id, usuario2Id] } },
      });
    }

    // Limpeza de pastas físicas criadas durante os testes
    for (const pasta of pastasCriadasParaLimpeza) {
      try {
        await fs.rm(pasta, { recursive: true, force: true });
      } catch {
        // ignora se já foi limpo
      }
    }

    if (usuario1Id || usuario2Id) {
      await Promise.all([usuario1Id, usuario2Id].filter(Boolean).map((usuarioId) =>
        importacaoDiagnosticoService.limparTodosArtefatosUsuario(usuarioId)
      ));
    }
  });

  describe('1. Regras de Naming e Sanitização de Diretórios', () => {
    it('deve gerar o caminho do diretório temporário no padrão estrito {UPLOADS_DIR}/{usuarioId}/yyyy-mm-dd-hh-mm-ss-{usuarioId}/', () => {
      const dataRef = new Date(2026, 9, 13, 15, 30, 45); // Mês 9 = Outubro (0-indexed)
      const caminho = storageService.gerarCaminhoDiretorioLote('uuid-teste-1234', dataRef);

      expect(caminho).toMatch(new RegExp(`${path.join(env.UPLOADS_DIR, 'uuid-teste-1234', '2026-10-13-15-30-45-uuid-teste-1234')}-`));
    });

    it('limpa os artefatos e remove também a pasta vazia do usuário', async () => {
      const raizUsuario = path.resolve(process.cwd(), env.UPLOADS_DIR, usuario1Id);
      await fs.mkdir(raizUsuario, { recursive: true });
      await fs.writeFile(path.join(raizUsuario, 'artefato-antigo.tmp'), 'teste');

      await importacaoDiagnosticoService.limparTodosArtefatosUsuario(usuario1Id);

      await expect(fs.stat(raizUsuario)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('preserva o pacote de uma importação ativa e arquiva original e extração ao finalizar', async () => {
      const arquivoIdTeste = randomUUID();
      const nomeArquivo = `diagnostico-${arquivoIdTeste}.pdf`;
      const original = Buffer.from('%PDF-1.4 teste de evidência');
      const hashConteudo = createHash('sha256').update(original).digest('hex');
      const caminhoOrigem = path.resolve(process.cwd(), env.UPLOADS_DIR, `${arquivoIdTeste}.pdf`);
      const lote = await prisma.loteImportacao.create({
        data: {
          usuarioId: usuario1Id,
          caminhoDiretorio: path.join(env.UPLOADS_DIR, usuario1Id, `lote-${arquivoIdTeste}`),
        },
      });
      const arquivo = await prisma.arquivoImportacao.create({
        data: {
          id: arquivoIdTeste,
          loteId: lote.id,
          usuarioId: usuario1Id,
          nomeArquivo,
          tamanhoBytes: BigInt(original.length),
          mimeType: 'application/pdf',
          caminhoRelativo: `${arquivoIdTeste}.pdf`,
          hashConteudo,
          status: 'ENVIADO_IA',
        },
      });
      await fs.writeFile(caminhoOrigem, original);

      try {
        await importacaoDiagnosticoService.iniciarArquivo(arquivo.id, caminhoOrigem, 'DEEPSEEK', 'deepseek-chat');
        const raizUsuario = path.resolve(process.cwd(), env.UPLOADS_DIR, usuario1Id);
        const hashAntigo = path.join(raizUsuario, 'artefato-antigo.zip');
        await fs.writeFile(hashAntigo, 'antigo');

        await importacaoDiagnosticoService.limparTodosArtefatosUsuario(usuario1Id);

        const pastaPacote = path.join(raizUsuario, hashConteudo);
        await expect(fs.stat(path.join(pastaPacote, `original.pdf`))).resolves.toBeDefined();
        await expect(fs.stat(hashAntigo)).rejects.toMatchObject({ code: 'ENOENT' });

        const caminhoExtracao = path.resolve(process.cwd(), env.UPLOADS_DIR, `${arquivoIdTeste}.json`);
        await fs.writeFile(caminhoExtracao, JSON.stringify({ totalTransacoes: 1, transacoes: [] }));
        await importacaoDiagnosticoService.copiarJson(arquivo.id, caminhoExtracao);
        await importacaoDiagnosticoService.finalizarArquivo(arquivo.id, 'SUCESSO');

        const caminhoZip = path.join(raizUsuario, `${hashConteudo}.zip`);
        const { stdout } = await execFileAsync('unzip', ['-Z1', caminhoZip]);
        expect(stdout).toContain('original.pdf');
        expect(stdout).toContain('extracao.json');
        expect(stdout).toContain('estado-final.json');
        await expect(fs.stat(path.join(raizUsuario, `.ativo-${arquivo.id}.json`))).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        await fs.rm(caminhoOrigem, { force: true });
        await fs.rm(path.resolve(process.cwd(), env.UPLOADS_DIR, `${arquivoIdTeste}.json`), { force: true });
        await importacaoDiagnosticoService.limparTodosArtefatosUsuario(usuario1Id);
      }
    });

    it('deve sanitizar o usuarioId para um único segmento de path (sem barras nem "..")', () => {
      const dataRef = new Date(2026, 9, 13, 15, 30, 45);
      const caminho = storageService.gerarCaminhoDiretorioLote('../../etc/passwd', dataRef);

      expect(caminho).toMatch(new RegExp(`${path.join(env.UPLOADS_DIR, 'etcpasswd', '2026-10-13-15-30-45-etcpasswd')}-`));
      expect(caminho).not.toContain('..');
    });

    it('deve sanitizar caminhos relativos e prevenir path traversal (ex: ../ e caminhos absolutos)', () => {
      const caminhoInseguro1 = '../../../etc/passwd';
      const seguro1 = storageService.sanitizarCaminhoRelativo(caminhoInseguro1);
      expect(seguro1).not.toContain('..');
      expect(seguro1).toBe(path.join('etc', 'passwd'));

      const caminhoPasta = 'extratos/faturas_2026/nubank_outubro.pdf';
      const seguro2 = storageService.sanitizarCaminhoRelativo(caminhoPasta);
      expect(seguro2).toBe(path.join('extratos', 'faturas_2026', 'nubank_outubro.pdf'));
    });
  });

  describe('2. Serviço de Recepção e Persistência de Lote', () => {
    it('deve salvar arquivos em disco e persistir lote e arquivos_importacao no PostgreSQL', async () => {
      let eventoCapturado: ImportacaoLoteRecepcionadoEvent | null = null;
      const listener = (ev: ImportacaoLoteRecepcionadoEvent) => {
        eventoCapturado = ev;
      };
      importacaoEventBus.onLoteRecepcionado(listener);

      const bufferPdf = Buffer.from('%PDF-1.4 Mock fatura nubank...');
      const bufferCsv = Buffer.from('data,descricao,valor\n2026-10-01,Mercado,150.00');

      const resultado = await storageService.recepcionarLote({
        usuarioId: usuario1Id,
        arquivos: [
          {
            nomeOriginal: 'faturas/fatura_nubank_outubro.pdf',
            buffer: bufferPdf,
            mimeType: 'application/pdf',
          },
          {
            nomeOriginal: 'extrato_inter.csv',
            buffer: bufferCsv,
            mimeType: 'text/csv',
          },
        ],
      });

      pastasCriadasParaLimpeza.push(path.resolve(process.cwd(), resultado.caminhoDiretorio));

      const diretoriosUsuario = (await fs.readdir(path.resolve(process.cwd(), env.UPLOADS_DIR, usuario1Id), { withFileTypes: true }))
        .filter((entrada) => entrada.isDirectory())
        .map((entrada) => entrada.name);
      expect(diretoriosUsuario).toContain(path.basename(resultado.caminhoDiretorio));

      expect(resultado.loteId).toBeDefined();
      expect(resultado.status).toBe('RECEPCIONADO');
      expect(resultado.totalArquivos).toBe(2);
      expect(resultado.arquivos).toHaveLength(2);
      expect(resultado.caminhoDiretorio).toContain(`${env.UPLOADS_DIR}/${usuario1Id}/`);
      expect(resultado.caminhoDiretorio).toContain(usuario1Id);

      // Validação física no disco
      const registrosSalvos = await prisma.arquivoImportacao.findMany({ where: { loteId: resultado.loteId } });
      const arquivoFisico1 = path.join(process.cwd(), resultado.caminhoDiretorio, registrosSalvos[0].caminhoRelativo);
      const arquivoFisico2 = path.join(process.cwd(), resultado.caminhoDiretorio, registrosSalvos[1].caminhoRelativo);
      expect(registrosSalvos[0].nomeArquivo).toBe('faturas/fatura_nubank_outubro.pdf');

      const stat1 = await fs.stat(arquivoFisico1);
      const stat2 = await fs.stat(arquivoFisico2);
      expect(stat1.isFile()).toBe(true);
      expect(stat2.isFile()).toBe(true);

      // Validação do evento emitido
      expect(eventoCapturado).not.toBeNull();
      expect((eventoCapturado as any).loteId).toBe(resultado.loteId);
      expect((eventoCapturado as any).usuarioId).toBe(usuario1Id);
      expect((eventoCapturado as any).totalArquivos).toBe(2);

      importacaoEventBus.removeListener(ImportacaoEventBus.EVENT_LOTE_RECEPCIONADO, listener);
    });

    it('TASK-58: preserva bytes e identidade quando arquivos do lote compartilham o mesmo nome original', async () => {
      const resultado = await storageService.recepcionarLote({
        usuarioId: usuario1Id,
        arquivos: [
          { nomeOriginal: 'extratos/mesmo.csv', buffer: Buffer.from('entrada-a'), mimeType: 'text/csv' },
          { nomeOriginal: 'extratos/mesmo.csv', buffer: Buffer.from('entrada-b'), mimeType: 'text/csv' },
        ],
      });
      pastasCriadasParaLimpeza.push(path.resolve(process.cwd(), resultado.caminhoDiretorio));
      const registros = await prisma.arquivoImportacao.findMany({ where: { loteId: resultado.loteId }, orderBy: { criadoEm: 'asc' } });
      expect(registros).toHaveLength(2);
      expect(new Set(registros.map((arquivo) => arquivo.caminhoRelativo)).size).toBe(2);
      const conteudos = await Promise.all(registros.map((arquivo) => fs.readFile(path.join(process.cwd(), resultado.caminhoDiretorio, arquivo.caminhoRelativo), 'utf8')));
      expect(conteudos.sort()).toEqual(['entrada-a', 'entrada-b']);
    });
  });

  describe('3. Rota REST de Upload (POST /api/importacao/upload) e Resposta 202 Accepted', () => {
    it('deve aceitar multipart/form-data com arquivos e responder imediatamente HTTP 202 Accepted', async () => {
      // Montagem de payload multipart com boundary
      const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
      const fileContent = 'Data,Historico,Valor\n2026-10-10,Padaria,25.50';

      const payload = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="arquivos"; filename="pasta_viagem/extrato_viagem.csv"',
        'Content-Type: text/csv',
        '',
        fileContent,
        `--${boundary}--`,
        '',
      ].join('\r\n');

      const response = await app.inject({
        method: 'POST',
        url: '/api/importacao/upload',
        headers: {
          authorization: `Bearer ${token1}`,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);

      expect(body.statusCode).toBe(202);
      expect(body.loteId).toBeDefined();
      expect(body.status).toBe('RECEPCIONADO');
      expect(body.totalArquivos).toBe(1);
      expect(body.caminhoDiretorio).toContain(usuario1Id);
      expect(body.arquivos).toHaveLength(1);
      await expect(fs.stat(path.resolve(process.cwd(), env.UPLOADS_DIR, '.spool')))
        .rejects.toMatchObject({ code: 'ENOENT' });
      expect(body.arquivos[0].nomeArquivo).toBe('extrato_viagem.csv');

      pastasCriadasParaLimpeza.push(path.resolve(process.cwd(), body.caminhoDiretorio));
    });

    it('deve retornar HTTP 400 se a requisição não for multipart ou não contiver arquivos', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/importacao/upload',
        headers: {
          authorization: `Bearer ${token1}`,
          'content-type': 'application/json',
        },
        payload: { teste: 123 },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('multipart/form-data');
    });

    it('deve retornar HTTP 401 para tentativa de upload não autenticada', async () => {
      const boundary = '----WebKitFormBoundarySemAuth';
      const payload = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="arquivo"; filename="teste.txt"',
        'Content-Type: text/plain',
        '',
        'conteudo de teste',
        `--${boundary}--`,
        '',
      ].join('\r\n');

      const response = await app.inject({
        method: 'POST',
        url: '/api/importacao/upload',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('4. Isolamento Multi-Tenant e Consulta de Lotes', () => {
    let loteUser1Id: string;

    beforeAll(async () => {
      const res = await storageService.recepcionarLote({
        usuarioId: usuario1Id,
        arquivos: [
          {
            nomeOriginal: 'privado_user1.pdf',
            buffer: Buffer.from('dados privados usuario 1'),
            mimeType: 'application/pdf',
          },
        ],
      });
      loteUser1Id = res.loteId;
      pastasCriadasParaLimpeza.push(path.resolve(process.cwd(), res.caminhoDiretorio));
    });

    it('usuário proprietário deve conseguir consultar seu próprio lote (GET /api/importacao/lotes/:id)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/importacao/lotes/${loteUser1Id}`,
        headers: { authorization: `Bearer ${token1}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.lote.id).toBe(loteUser1Id);
      expect(body.lote.usuarioId).toBe(usuario1Id);
      expect(body.lote.arquivos).toHaveLength(1);
    });

    it('deve expor métricas agregadas apenas ao usuário dono do lote', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/importacao/lotes/${loteUser1Id}/metricas`,
        headers: { authorization: `Bearer ${token1}` },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.loteId).toBe(loteUser1Id);
      expect(body.arquivos.total).toBe(1);
      expect(body.ia.duracaoMs).toHaveProperty('p50');
      expect(body.ia.duracaoMs).toHaveProperty('p95');
      expect(body.processo.rssBytes).toBeGreaterThan(0);

      const negada = await app.inject({
        method: 'GET',
        url: `/api/importacao/lotes/${loteUser1Id}/metricas`,
        headers: { authorization: `Bearer ${token2}` },
      });
      expect(negada.statusCode).toBe(404);
    });

    it('outro usuário não deve conseguir acessar lote alheio, recebendo HTTP 404 (Isolamento Multi-Tenant)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/importacao/lotes/${loteUser1Id}`,
        headers: { authorization: `Bearer ${token2}` },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('não encontrado');
    });

    it('listagem de lotes (GET /api/importacao/lotes) deve conter apenas os lotes do usuário solicitante', async () => {
      const responseUser2 = await app.inject({
        method: 'GET',
        url: '/api/importacao/lotes',
        headers: { authorization: `Bearer ${token2}` },
      });

      expect(responseUser2.statusCode).toBe(200);
      const body2 = JSON.parse(responseUser2.body);
      expect(body2.lotes).toHaveLength(0);

      const responseUser1 = await app.inject({
        method: 'GET',
        url: '/api/importacao/lotes',
        headers: { authorization: `Bearer ${token1}` },
      });

      expect(responseUser1.statusCode).toBe(200);
      const body1 = JSON.parse(responseUser1.body);
      expect(body1.lotes.length).toBeGreaterThanOrEqual(1);
      const ids = body1.lotes.map((l: any) => l.id);
      expect(ids).toContain(loteUser1Id);
    });

    it('deve conectar ao endpoint SSE GET /api/importacao/stream-eventos com autenticação e emitir evento connected', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/importacao/stream-eventos?testClose=true',
        headers: { authorization: `Bearer ${token1}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.body).toContain('event: connected');
      expect(response.body).toContain(usuario1Id);
    });

    it('deve retornar lançamentos e consolidado do arquivo com autenticação (GET /api/importacao/arquivos/:id/lancamentos)', async () => {
      const lote = await prisma.loteImportacao.findUnique({
        where: { id: loteUser1Id },
        include: { arquivos: true },
      });
      const arquivoId = lote!.arquivos[0].id;

      const response = await app.inject({
        method: 'GET',
        url: `/api/importacao/arquivos/${arquivoId}/lancamentos`,
        headers: { authorization: `Bearer ${token1}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.arquivo.id).toBe(arquivoId);
      expect(body.resumo).toBeDefined();
      expect(Array.isArray(body.movimentos)).toBe(true);
      expect(Array.isArray(body.stagingItens)).toBe(true);

      // Usuário 2 não tem acesso ao arquivo do Usuário 1
      const responseUser2 = await app.inject({
        method: 'GET',
        url: `/api/importacao/arquivos/${arquivoId}/lancamentos`,
        headers: { authorization: `Bearer ${token2}` },
      });
      expect(responseUser2.statusCode).toBe(404);
    });
  });
});
