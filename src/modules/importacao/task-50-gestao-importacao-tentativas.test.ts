import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ImportacaoStorageService } from './importacao-storage.service.js';
import { ImportacaoTentativasService } from './importacao-tentativas.service.js';
import { ImportacaoIaWorkerService } from './worker/importacao-ia-worker.service.js';
import { IIaExtratorClient } from './worker/ia-extrator.client.js';
import { LancamentoConsolidadoIa } from './worker/ia-extrator.schema.js';

/**
 * TASK-50 — Gestão de Importação: Lote → Arquivo → Detalhe
 * (tentativas de extração, alerta de duplicidade e contadores do lote).
 */
describe('TASK-50: Gestão de Importação — Lote → Arquivo → Detalhe (tentativas e duplicidade)', () => {
  let app: FastifyInstance;
  let usuarioAId: string;
  let tokenA: string;
  let usuarioBId: string;
  let tokenB: string;

  const storageService = new ImportacaoStorageService();
  const pastasParaLimpeza: string[] = [];

  const transacaoMock = (descricao: string): LancamentoConsolidadoIa => ({
    dataMovimento: '2026-10-10',
    descricao,
    valor: 42.9,
    natureza: 'DESPESA',
    contaSugerida: 'Conta Corrente Task50',
    tipoConta: 'CONTA_CORRENTE',
    categoriaSugerida: null,
    parcelaAtual: null,
    totalParcelas: null,
    idOrigem: null,
    isPagamentoFatura: false,
    observacao: 'Extração simulada TASK-50',
    confianca: 0.99,
  });

  /**
   * Executa um upload multipart/form-data de um único arquivo, garantindo que o
   * boundary do header seja exatamente o mesmo usado no payload.
   */
  let contadorBoundary = 0;
  const upload = (
    token: string,
    nomeArquivo: string,
    conteudo: string,
    url = '/api/importacao/upload'
  ) => {
    contadorBoundary += 1;
    const boundary = `----Task50Boundary${Date.now()}x${contadorBoundary}`;
    const payload = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="arquivos"; filename="${nomeArquivo}"`,
      'Content-Type: text/csv',
      '',
      conteudo,
      `--${boundary}--`,
      '',
    ].join('\r\n');

    return app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
  };

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const emailA = `user-task50-a-${Date.now()}@evolvi.app`;
    const resA = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: { nome: 'Usuario Task50 A', email: emailA, senha: 'SenhaForte123!' },
    });
    const bodyA = JSON.parse(resA.body);
    usuarioAId = bodyA.usuario.id;
    tokenA = bodyA.token;

    const emailB = `user-task50-b-${Date.now()}@evolvi.app`;
    const resB = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: { nome: 'Usuario Task50 B', email: emailB, senha: 'SenhaForte123!' },
    });
    const bodyB = JSON.parse(resB.body);
    usuarioBId = bodyB.usuario.id;
    tokenB = bodyB.token;

    await prisma.conta.create({
      data: { usuarioId: usuarioAId, nome: 'Conta Corrente Task50', tipo: 'CONTA_CORRENTE' },
    });
  });

  afterAll(async () => {
    const usuarios = [usuarioAId, usuarioBId].filter(Boolean);
    if (usuarios.length > 0) {
      await prisma.tentativaArquivoImportacao.deleteMany({
        where: { usuarioId: { in: usuarios } },
      });
      await prisma.stagingLancamentoImportacao.deleteMany({
        where: { lote: { usuarioId: { in: usuarios } } },
      });
      await prisma.arquivoImportacao.updateMany({
        where: { usuarioId: { in: usuarios } },
        data: { arquivoOriginalId: null },
      });
      await prisma.arquivoImportacao.deleteMany({
        where: { lote: { usuarioId: { in: usuarios } } },
      });
      await prisma.loteImportacao.deleteMany({ where: { usuarioId: { in: usuarios } } });
      await prisma.configuracaoIaUsuario.deleteMany({
        where: { usuarioId: { in: usuarios } },
      });
      await prisma.conta.deleteMany({ where: { usuarioId: { in: usuarios } } });
      await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
    }

    for (const pasta of pastasParaLimpeza) {
      try {
        await fs.rm(pasta, { recursive: true, force: true });
      } catch {
        // ignora
      }
    }
  });

  // -------------------------------------------------------------------------
  // (a) Reenvio do mesmo arquivo → alerta de duplicidade + tentativa DUPLICADO
  // -------------------------------------------------------------------------
  it('(a) reenviar o mesmo arquivo gera alerta de duplicidade e registra tentativa DUPLICADO', async () => {
    const conteudo = 'data,descricao,valor\n2026-10-10,Padaria Task50,25.50';

    const primeiro = await upload(tokenA, 'extrato_task50.csv', conteudo);

    expect(primeiro.statusCode).toBe(202);
    const bodyPrimeiro = JSON.parse(primeiro.body);
    pastasParaLimpeza.push(path.resolve(process.cwd(), bodyPrimeiro.caminhoDiretorio));
    expect(bodyPrimeiro.requerConfirmacaoReprocessamento).toBe(false);
    expect(bodyPrimeiro.alertasDuplicidade).toHaveLength(0);
    expect(bodyPrimeiro.arquivos[0].hashConteudo).toMatch(/^[a-f0-9]{64}$/);

    const primeiroArquivoId = bodyPrimeiro.arquivos[0].id;

    // Reenvio do mesmo arquivo (mesmo nome e mesmo conteúdo)
    const segundo = await upload(tokenA, 'extrato_task50.csv', conteudo);

    expect(segundo.statusCode).toBe(409);
    const bodySegundo = JSON.parse(segundo.body);

    expect(bodySegundo.requerConfirmacaoReprocessamento).toBe(true);
    expect(bodySegundo.jaImportadoAnteriormente).toBe(true);
    expect(bodySegundo.duplicados.length).toBe(1);
    expect(bodySegundo.duplicados[0].nomeArquivo).toBe('extrato_task50.csv');
    expect(bodySegundo.duplicados[0].motivos).toEqual(
      expect.arrayContaining(['MESMO_NOME', 'MESMO_HASH'])
    );
    expect(bodySegundo.duplicados[0].motivo).toContain('MESMO_HASH');
    expect(bodySegundo.duplicados[0].arquivoOriginalId).toBe(primeiroArquivoId);
    expect(bodySegundo.totalDuplicados).toBe(1);

    const duplicadoId = bodySegundo.arquivos[0].id;
    const arquivoDuplicado = await prisma.arquivoImportacao.findUnique({
      where: { id: duplicadoId },
    });
    expect(arquivoDuplicado?.jaImportadoAnteriormente).toBe(true);
    expect(arquivoDuplicado?.statusFinal).toBe('DUPLICADO');
    expect(arquivoDuplicado?.totalTentativas).toBe(1);

    // A tentativa DUPLICADO foi registrada no histórico do arquivo
    const tentativasDuplicado = await prisma.tentativaArquivoImportacao.findMany({
      where: { usuarioId: usuarioAId, arquivoId: duplicadoId },
      orderBy: { numeroTentativa: 'asc' },
    });
    expect(tentativasDuplicado).toHaveLength(1);
    expect(tentativasDuplicado[0].status).toBe('DUPLICADO');
    expect(tentativasDuplicado[0].numeroTentativa).toBe(1);
    expect(tentativasDuplicado[0].mensagemErro).toContain('já importado anteriormente');

    // Endpoint de tentativas retorna a linha DUPLICADO
    const respostaTentativas = await app.inject({
      method: 'GET',
      url: `/api/importacao/arquivos/${duplicadoId}/tentativas`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(respostaTentativas.statusCode).toBe(200);
    const bodyTentativas = JSON.parse(respostaTentativas.body);
    expect(bodyTentativas.total).toBe(1);
    expect(bodyTentativas.tentativas[0].status).toBe('DUPLICADO');

    // Confirmação explícita libera o arquivo para reprocessamento
    const confirmacao = await app.inject({
      method: 'POST',
      url: `/api/importacao/arquivos/${duplicadoId}/confirmar-reprocessamento`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(confirmacao.statusCode).toBe(200);
    const bodyConfirmacao = JSON.parse(confirmacao.body);
    expect(bodyConfirmacao.arquivo.jaImportadoAnteriormente).toBe(false);
  });

  // -------------------------------------------------------------------------
  // (b) IA A falha + IA B sucesso → 2 tentativas e totalTentativas = 2
  // -------------------------------------------------------------------------
  it('(b) IA A falha e IA B sucede gera 2 tentativas com status corretos e totalTentativas = 2', async () => {
    // Configura dois provedores para o usuário: GEMINI (principal) e DEEPSEEK (fallback)
    const { CryptoService } = await import('../../infrastructure/security/crypto.service.js');
    const enc = CryptoService.encrypt('sk-mock-task50-1234567890');
    for (const provedor of ['GEMINI', 'DEEPSEEK']) {
      await prisma.configuracaoIaUsuario.upsert({
        where: { usuarioId_provedor: { usuarioId: usuarioAId, provedor } },
        create: {
          usuarioId: usuarioAId,
          provedor,
          modelo: provedor === 'GEMINI' ? 'gemini-3.8-flash' : 'deepseek-chat',
          apiKeyCifrada: enc.ciphertext,
          ivHex: enc.iv,
          tagHex: enc.tag,
        },
        update: {
          modelo: provedor === 'GEMINI' ? 'gemini-3.8-flash' : 'deepseek-chat',
          apiKeyCifrada: enc.ciphertext,
          ivHex: enc.iv,
          tagHex: enc.tag,
        },
      });
    }

    const lote = await storageService.recepcionarLote({
      usuarioId: usuarioAId,
      arquivos: [
        {
          nomeOriginal: 'extrato_fallback_task50.csv',
          buffer: Buffer.from('data,descricao,valor\n2026-10-11,Mercado Task50,99.90', 'utf-8'),
          mimeType: 'text/csv',
        },
      ],
    });
    pastasParaLimpeza.push(path.resolve(process.cwd(), lote.caminhoDiretorio));

    const arquivoId = lote.arquivos[0].id;
    let chamadas = 0;

    // Mock: primeira chamada (GEMINI) falha; segunda (DEEPSEEK) retorna transações
    const extratorMock: IIaExtratorClient = {
      async extrairTransacoes(params) {
        chamadas += 1;
        if (chamadas === 1) {
          throw new Error('Quota excedida no provedor primário (HTTP 429).');
        }
        // Simula handoff do log de telemetria criado pelo cliente real (TASK-49/50)
        const log = await prisma.usoIaLog.create({
          data: {
            usuarioId: params.usuarioId!,
            funcionalidade: 'EXTRACAO_EXTRATO',
            provedor: params.provedorIa || 'DEEPSEEK',
            modelo: params.modeloIa || 'deepseek-chat',
            duracaoMs: 12,
            status: 'SUCESSO',
            loteId: params.loteId,
            arquivoId: params.arquivoId,
          },
          select: { id: true },
        });
        params.aoRegistrarUsoIa?.(log.id);
        return [transacaoMock('Compra Mercado Task50')];
      },
    };

    const worker = new ImportacaoIaWorkerService(extratorMock, process.cwd(), false);
    const resultado = await worker.processarLote(lote.loteId, {
      provedorIa: 'GEMINI',
      modeloIa: 'gemini-3.8-flash',
    });

    expect(resultado.arquivosProcessadosComSucesso).toBe(1);
    expect(resultado.arquivosComErro).toBe(0);
    expect(chamadas).toBe(2);

    const tentativas = await prisma.tentativaArquivoImportacao.findMany({
      where: { usuarioId: usuarioAId, arquivoId },
      orderBy: { numeroTentativa: 'asc' },
    });

    expect(tentativas).toHaveLength(2);
    expect(tentativas[0].numeroTentativa).toBe(1);
    expect(tentativas[0].provedor).toBe('GEMINI');
    expect(tentativas[0].status).toBe('FALHA');
    expect(tentativas[0].mensagemErro).toContain('Quota excedida');

    expect(tentativas[1].numeroTentativa).toBe(2);
    expect(tentativas[1].provedor).toBe('DEEPSEEK');
    expect(tentativas[1].status).toBe('SUCESSO');
    expect(tentativas[1].totalTransacoesExtraidas).toBe(1);
    // Correlação do log de telemetria de IA (TASK-49) via handoff explícito
    expect(tentativas[1].usoIaLogId).toBeTruthy();
    const logCorrelacionado = await prisma.usoIaLog.findUnique({
      where: { id: tentativas[1].usoIaLogId! },
    });
    expect(logCorrelacionado?.arquivoId).toBe(arquivoId);
    expect(logCorrelacionado?.provedor).toBe('DEEPSEEK');

    const arquivoFinal = await prisma.arquivoImportacao.findUnique({ where: { id: arquivoId } });
    expect(arquivoFinal?.totalTentativas).toBe(2);
    expect(arquivoFinal?.status).toBe('IA_CONCLUIDO');
    expect(arquivoFinal?.statusFinal).toBe('SUCESSO');
    expect(arquivoFinal?.ultimoProvedor).toBe('DEEPSEEK');

    // Evento consolidado foi gerado com os metadados do provedor que teve sucesso
    const consolidado = JSON.parse(
      await fs.readFile(
        path.resolve(process.cwd(), lote.caminhoDiretorio, `consolidado_${arquivoId}.json`),
        'utf-8'
      )
    );
    expect(consolidado.metadados.provedor).toBe('DEEPSEEK');
    expect(consolidado.transacoes).toHaveLength(1);

    await prisma.usoIaLog.deleteMany({ where: { usuarioId: usuarioAId } });
  });

  // -------------------------------------------------------------------------
  // (c) Isolamento multi-tenant
  // -------------------------------------------------------------------------
  it('(c) usuário B não recebe alerta nem acessa arquivos/tentativas do usuário A', async () => {
    const conteudo = 'data,descricao,valor\n2026-10-12,Isolamento Task50,10.00';

    const loteA = await upload(tokenA, 'extrato_isolado.csv', conteudo);
    const bodyA = JSON.parse(loteA.body);
    pastasParaLimpeza.push(path.resolve(process.cwd(), bodyA.caminhoDiretorio));
    const arquivoAId = bodyA.arquivos[0].id;

    // Cria uma tentativa para o arquivo do usuário A
    await ImportacaoTentativasService.registrarTentativa({
      usuarioId: usuarioAId,
      arquivoId: arquivoAId,
      provedor: 'GEMINI',
      modelo: 'gemini-3.8-flash',
      status: 'SUCESSO',
      totalTransacoesExtraidas: 3,
      duracaoMs: 250,
    });

    // Usuário B envia um arquivo com o MESMO nome e MESMO conteúdo
    const loteB = await upload(tokenB, 'extrato_isolado.csv', conteudo);

    // Não há alerta de duplicidade cruzando usuários
    expect(loteB.statusCode).toBe(202);
    const bodyB = JSON.parse(loteB.body);
    pastasParaLimpeza.push(path.resolve(process.cwd(), bodyB.caminhoDiretorio));
    expect(bodyB.requerConfirmacaoReprocessamento).toBe(false);
    expect(bodyB.alertasDuplicidade).toHaveLength(0);
    expect(bodyB.arquivos[0].jaImportadoAnteriormente).toBe(false);

    // Usuário B não enxerga as tentativas do arquivo do usuário A
    const tentativasCruzadas = await app.inject({
      method: 'GET',
      url: `/api/importacao/arquivos/${arquivoAId}/tentativas`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(tentativasCruzadas.statusCode).toBe(404);

    // Nem consegue confirmar reprocessamento de arquivo alheio
    const confirmacaoCruzada = await app.inject({
      method: 'POST',
      url: `/api/importacao/arquivos/${arquivoAId}/confirmar-reprocessamento`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(confirmacaoCruzada.statusCode).toBe(404);

    // O proprietário enxerga normalmente
    const tentativasProprietario = await app.inject({
      method: 'GET',
      url: `/api/importacao/arquivos/${arquivoAId}/tentativas`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(tentativasProprietario.statusCode).toBe(200);
    expect(JSON.parse(tentativasProprietario.body).total).toBe(1);

    // A listagem de tentativas é sempre filtrada por usuarioId
    const tentativasUsuarioB = await prisma.tentativaArquivoImportacao.count({
      where: { usuarioId: usuarioBId },
    });
    expect(tentativasUsuarioB).toBe(0);
  });

  // -------------------------------------------------------------------------
  // (d) Ordenação e paginação do endpoint de tentativas
  // -------------------------------------------------------------------------
  it('(d) GET /arquivos/:id/tentativas retorna as tentativas em ordem crescente e paginadas', async () => {
    const lote = await storageService.recepcionarLote({
      usuarioId: usuarioAId,
      arquivos: [
        {
          nomeOriginal: 'extrato_paginacao_task50.csv',
          buffer: Buffer.from('data,descricao,valor\n2026-10-13,Paginacao Task50,7.70', 'utf-8'),
          mimeType: 'text/csv',
        },
      ],
    });
    pastasParaLimpeza.push(path.resolve(process.cwd(), lote.caminhoDiretorio));
    const arquivoId = lote.arquivos[0].id;

    // Cria 5 tentativas sequenciais (a última com sucesso)
    for (let i = 1; i <= 5; i += 1) {
      await ImportacaoTentativasService.registrarTentativa({
        usuarioId: usuarioAId,
        arquivoId,
        provedor: i % 2 === 0 ? 'DEEPSEEK' : 'GEMINI',
        modelo: i % 2 === 0 ? 'deepseek-chat' : 'gemini-3.8-flash',
        status: i === 5 ? 'SUCESSO' : 'FALHA',
        mensagemErro: i === 5 ? null : `Falha simulada #${i}`,
        totalTransacoesExtraidas: i === 5 ? 4 : 0,
        duracaoMs: 100 * i,
      });
    }

    const pagina1 = await app.inject({
      method: 'GET',
      url: `/api/importacao/arquivos/${arquivoId}/tentativas?pagina=1&limite=2`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(pagina1.statusCode).toBe(200);
    const bodyPagina1 = JSON.parse(pagina1.body);
    expect(bodyPagina1.total).toBe(5);
    expect(bodyPagina1.pagina).toBe(1);
    expect(bodyPagina1.limite).toBe(2);
    expect(bodyPagina1.totalPaginas).toBe(3);
    expect(bodyPagina1.tentativas.map((t: any) => t.numeroTentativa)).toEqual([1, 2]);

    const pagina3 = await app.inject({
      method: 'GET',
      url: `/api/importacao/arquivos/${arquivoId}/tentativas?pagina=3&limite=2`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    const bodyPagina3 = JSON.parse(pagina3.body);
    expect(bodyPagina3.tentativas.map((t: any) => t.numeroTentativa)).toEqual([5]);
    expect(bodyPagina3.tentativas[0].status).toBe('SUCESSO');

    // Validação de query inválida
    const invalida = await app.inject({
      method: 'GET',
      url: `/api/importacao/arquivos/${arquivoId}/tentativas?pagina=0`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(invalida.statusCode).toBe(400);
  });

  // -------------------------------------------------------------------------
  // (e) Contadores do lote recalculados
  // -------------------------------------------------------------------------
  it('(e) contadores do lote (totalArquivos/totalSucesso/totalFalha/totalDuplicados/totalLancamentos) são recalculados', async () => {
    // Lote com 2 arquivos distintos: 1 sucesso e 1 falha
    const lote = await storageService.recepcionarLote({
      usuarioId: usuarioAId,
      arquivos: [
        {
          nomeOriginal: 'contadores_ok_task50.csv',
          buffer: Buffer.from('data,descricao,valor\n2026-10-14,Contador OK,11.00', 'utf-8'),
          mimeType: 'text/csv',
        },
        {
          // Conteúdo não estruturado com múltiplas linhas: o extrator mock falhará
          nomeOriginal: 'contadores_falha_task50.pdf',
          buffer: Buffer.from(
            'linha um sem dados\nlinha dois sem dados\nlinha tres sem dados',
            'utf-8'
          ),
          mimeType: 'application/pdf',
        },
      ],
    });
    pastasParaLimpeza.push(path.resolve(process.cwd(), lote.caminhoDiretorio));

    let chamada = 0;
    const extratorMock: IIaExtratorClient = {
      async extrairTransacoes(params) {
        chamada += 1;
        if (params.nomeArquivo.includes('falha')) {
          throw new Error('Documento ilegível para o provedor de IA.');
        }
        return [transacaoMock('Contador OK'), transacaoMock('Contador OK 2')];
      },
    };

    const worker = new ImportacaoIaWorkerService(extratorMock, process.cwd(), false);
    await worker.processarLote(lote.loteId, { provedorIa: 'GEMINI' });
    expect(chamada).toBeGreaterThanOrEqual(2);

    const loteAposProcessamento = await prisma.loteImportacao.findUnique({
      where: { id: lote.loteId },
    });
    expect(loteAposProcessamento?.totalArquivos).toBe(2);
    expect(loteAposProcessamento?.totalSucesso).toBe(1);
    expect(loteAposProcessamento?.totalFalha).toBe(1);
    expect(loteAposProcessamento?.totalDuplicados).toBe(0);

    // Carrega o arquivo com sucesso em staging e recalcula os lançamentos contabilizados
    const { importacaoStagingWorkerService } = await import(
      './worker/importacao-staging-worker.service.js'
    );
    const arquivoComSucesso = await prisma.arquivoImportacao.findFirst({
      where: { loteId: lote.loteId, nomeArquivo: 'contadores_ok_task50.csv' },
    });
    await importacaoStagingWorkerService.carregarArquivoParaStaging(
      arquivoComSucesso!.id,
      usuarioAId
    );
    const contadores = await ImportacaoTentativasService.recalcularContadoresLote(lote.loteId);

    expect(contadores.totalArquivos).toBe(2);
    expect(contadores.totalSucesso).toBe(1);
    expect(contadores.totalFalha).toBe(1);
    expect(contadores.totalDuplicados).toBe(0);
    expect(contadores.totalLancamentos).toBeGreaterThanOrEqual(2);

    const loteFinal = await prisma.loteImportacao.findUnique({ where: { id: lote.loteId } });
    expect(loteFinal?.totalLancamentos).toBe(contadores.totalLancamentos);

    // Reenvio do mesmo arquivo de sucesso → totalDuplicados = 1 ao final do upload
    const duplicado = await storageService.recepcionarLote({
      usuarioId: usuarioAId,
      arquivos: [
        {
          nomeOriginal: 'contadores_ok_task50.csv',
          buffer: Buffer.from('data,descricao,valor\n2026-10-14,Contador OK,11.00', 'utf-8'),
          mimeType: 'text/csv',
        },
      ],
    });
    pastasParaLimpeza.push(path.resolve(process.cwd(), duplicado.caminhoDiretorio));

    expect(duplicado.totalDuplicados).toBe(1);
    expect(duplicado.totalArquivos).toBe(1);
    const loteDuplicado = await prisma.loteImportacao.findUnique({
      where: { id: duplicado.loteId },
    });
    expect(loteDuplicado?.totalDuplicados).toBe(1);
    expect(loteDuplicado?.totalFalha).toBe(0);
  });

  // -------------------------------------------------------------------------
  // (f) Forçar reprocessamento via upload (flag forcarReprocessamento)
  // -------------------------------------------------------------------------
  it('(f) forcarReprocessamento=true no upload libera o arquivo duplicado sem alerta bloqueante', async () => {
    const conteudo = 'data,descricao,valor\n2026-10-15,Forcar Task50,3.30';

    const primeiro = await upload(tokenA, 'extrato_forcar.csv', conteudo);
    expect(primeiro.statusCode).toBe(202);
    pastasParaLimpeza.push(path.resolve(process.cwd(), JSON.parse(primeiro.body).caminhoDiretorio));

    const forcado = await upload(
      tokenA,
      'extrato_forcar.csv',
      conteudo,
      '/api/importacao/upload?forcarReprocessamento=true'
    );
    expect(forcado.statusCode).toBe(202);
    const bodyForcado = JSON.parse(forcado.body);
    pastasParaLimpeza.push(path.resolve(process.cwd(), bodyForcado.caminhoDiretorio));

    expect(bodyForcado.requerConfirmacaoReprocessamento).toBe(false);
    // A identificação de duplicidade permanece auditável no alerta
    expect(bodyForcado.alertasDuplicidade.length).toBe(1);
    expect(bodyForcado.arquivos[0].jaImportadoAnteriormente).toBe(false);

    const arquivoForcado = await prisma.arquivoImportacao.findUnique({
      where: { id: bodyForcado.arquivos[0].id },
    });
    expect(arquivoForcado?.statusFinal).toBeNull();
    expect(arquivoForcado?.arquivoOriginalId).toBeTruthy();
  });
});
