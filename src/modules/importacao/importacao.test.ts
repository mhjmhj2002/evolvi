import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ImportacaoStorageService } from './importacao-storage.service.js';
import {
  importacaoEventBus,
  ImportacaoEventBus,
  ImportacaoLoteRecepcionadoEvent,
} from '../../infrastructure/events/importacao-event-bus.js';

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
  });

  describe('1. Regras de Naming e Sanitização de Diretórios', () => {
    it('deve gerar o caminho do diretório temporário no padrão estrito uploads/yyyy-mm-dd-hh-mm-ss-{usuarioId}/', () => {
      const dataRef = new Date(2026, 9, 13, 15, 30, 45); // Mês 9 = Outubro (0-indexed)
      const caminho = storageService.gerarCaminhoDiretorioLote('uuid-teste-1234', dataRef);

      expect(caminho).toBe(path.join('uploads', '2026-10-13-15-30-45-uuid-teste-1234'));
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

      expect(resultado.loteId).toBeDefined();
      expect(resultado.status).toBe('RECEPCIONADO');
      expect(resultado.totalArquivos).toBe(2);
      expect(resultado.arquivos).toHaveLength(2);
      expect(resultado.caminhoDiretorio).toContain(`uploads/`);
      expect(resultado.caminhoDiretorio).toContain(usuario1Id);

      // Validação física no disco
      const arquivoFisico1 = path.join(
        process.cwd(),
        resultado.caminhoDiretorio,
        'faturas',
        'fatura_nubank_outubro.pdf'
      );
      const arquivoFisico2 = path.join(
        process.cwd(),
        resultado.caminhoDiretorio,
        'extrato_inter.csv'
      );

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
  });
});
