import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { ImportacaoConsolidacaoWorkerService } from './importacao-consolidacao-worker.service.js';
import { gerarChaveDedupe } from '../../movimento/movimento.util.js';

describe('BUG-10: Garantia de Deduplicação, Chave Única Multi-Tenant, idOrigem e Controle de Concorrência', () => {
  let usuarioId: string;
  let outroUsuarioId: string;
  let contaId: string;
  let outraContaId: string;
  let loteId: string;
  let arquivoId: string;
  const consolidacaoWorker = new ImportacaoConsolidacaoWorkerService();

  beforeAll(async () => {
    // 1. Usuário principal
    const usuario = await prisma.usuario.create({
      data: {
        nome: 'Usuario Bug 10',
        email: `test-bug-10-${Date.now()}@evolvi.app`,
        senhaHash: 'hash123',
      },
    });
    usuarioId = usuario.id;

    // 2. Outro usuário para teste de isolamento multi-tenant
    const outroUsuario = await prisma.usuario.create({
      data: {
        nome: 'Outro Usuario Bug 10',
        email: `outro-bug-10-${Date.now()}@evolvi.app`,
        senhaHash: 'hash123',
      },
    });
    outroUsuarioId = outroUsuario.id;

    // Contas bancárias
    const conta = await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Conta Corrente Principal',
        tipo: 'CONTA_CORRENTE',
      },
    });
    contaId = conta.id;

    const outraConta = await prisma.conta.create({
      data: {
        usuarioId: outroUsuarioId,
        nome: 'Conta Outro Usuario',
        tipo: 'CONTA_CORRENTE',
      },
    });
    outraContaId = outraConta.id;

    // Lote de importação
    const lote = await prisma.loteImportacao.create({
      data: {
        usuarioId,
        caminhoDiretorio: 'uploads/test-bug-10',
        status: 'CARGA_STAGING',
      },
    });
    loteId = lote.id;

    const arquivo = await prisma.arquivoImportacao.create({
      data: {
        loteId,
        nomeArquivo: 'fatura_teste_dedupe.csv',
        caminhoRelativo: 'fatura_teste_dedupe.csv',
        status: 'STAGING_CARREGADO',
      },
    });
    arquivoId = arquivo.id;
  });

  afterAll(async () => {
    if (usuarioId) {
      await prisma.movimento.deleteMany({ where: { usuarioId } });
      await prisma.stagingLancamentoImportacao.deleteMany({ where: { loteId } });
      await prisma.arquivoImportacao.deleteMany({ where: { loteId } });
      await prisma.loteImportacao.deleteMany({ where: { usuarioId } });
      await prisma.conta.deleteMany({ where: { usuarioId } });
      await prisma.usuario.deleteMany({ where: { id: usuarioId } });
    }
    if (outroUsuarioId) {
      await prisma.movimento.deleteMany({ where: { usuarioId: outroUsuarioId } });
      await prisma.conta.deleteMany({ where: { usuarioId: outroUsuarioId } });
      await prisma.usuario.deleteMany({ where: { id: outroUsuarioId } });
    }
  });

  it('1. Deve gerar chaves de deduplicação determinísticas estruturadas (padrão planilha com idOrigem e OCC)', () => {
    // Chave com idOrigem nativo
    const chaveComId1 = gerarChaveDedupe({
      contaId,
      dataMovimento: '2026-02-26',
      valor: 134.8,
      descricao: 'A S MATERIAIS',
      idOrigem: 'DOC-123456',
    });

    const chaveComId2 = gerarChaveDedupe({
      contaId,
      dataMovimento: '2026-02-26',
      valor: 134.8,
      descricao: 'A S MATERIAIS - Parcela 1', // Descrição ligeiramente alterada
      idOrigem: 'DOC-123456',
    });

    // Como idOrigem é o identificador único oficial, ambas produzem a mesma chave
    expect(chaveComId1).toBe(chaveComId2);

    // Chave sem idOrigem com contador ordinal de ocorrência (OCC)
    const chaveOcc1 = gerarChaveDedupe({
      contaId,
      dataMovimento: '2026-02-26',
      valor: 9.3,
      descricao: '99app *99app',
      ocorrencia: 1,
    });

    const chaveOcc2 = gerarChaveDedupe({
      contaId,
      dataMovimento: '2026-02-26',
      valor: 9.3,
      descricao: '99app *99app',
      ocorrencia: 2,
    });

    expect(chaveOcc1).not.toBe(chaveOcc2);
  });

  it('2. Constraint UNIQUE multi-tenant deve bloquear inserção física concorrente com erro P2002', async () => {
    const chaveDedupe = `dedupe-unique-test-${Date.now()}`;

    // Primeira inserção deve suceder
    await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: new Date('2026-02-26T00:00:00.000Z'),
        competencia: '2026-02',
        descricao: 'A S MATERIAIS',
        valor: 134.8,
        natureza: 'DESPESA',
        chaveDedupe,
      },
    });

    // Segunda inserção para o mesmo usuário com a mesma chave deve falhar com P2002
    await expect(
      prisma.movimento.create({
        data: {
          usuarioId,
          contaId,
          dataMovimento: new Date('2026-02-26T00:00:00.000Z'),
          competencia: '2026-02',
          descricao: 'A S MATERIAIS',
          valor: 134.8,
          natureza: 'DESPESA',
          chaveDedupe,
        },
      })
    ).rejects.toThrow();

    // Outro usuário pode ter a mesma chaveDedupe sem colisão (isolamento multi-tenant)
    const movOutroUsuario = await prisma.movimento.create({
      data: {
        usuarioId: outroUsuarioId,
        contaId: outraContaId,
        dataMovimento: new Date('2026-02-26T00:00:00.000Z'),
        competencia: '2026-02',
        descricao: 'A S MATERIAIS',
        valor: 134.8,
        natureza: 'DESPESA',
        chaveDedupe,
      },
    });
    expect(movOutroUsuario.id).toBeDefined();
  });

  it('3. Worker de consolidação deve absorver e ignorar duplicatas concorrentes simultâneas', async () => {
    // Insere 2 registros idênticos na staging simulando arquivos simultâneos do mesmo lote
    const dataMovimento = new Date('2026-02-26T00:00:00.000Z');
    const desc = 'Corrida 99app Dedupe Concorrente';
    const valor = 9.3;

    await prisma.stagingLancamentoImportacao.createMany({
      data: [
        {
          loteId,
          arquivoId,
          arquivoOrigem: 'arquivo_1.csv',
          dataMovimento,
          descricao: desc,
          valor,
          natureza: 'DESPESA',
          contaSugerida: 'Conta Corrente Principal',
          statusProcessamento: 'PENDENTE',
        },
        {
          loteId,
          arquivoId,
          arquivoOrigem: 'arquivo_2.csv',
          dataMovimento,
          descricao: desc,
          valor,
          natureza: 'DESPESA',
          contaSugerida: 'Conta Corrente Principal',
          statusProcessamento: 'PENDENTE',
        },
      ],
    });

    // Executa 2 consolidações paralelas simultâneas simulando race condition de eventos
    const [res1, res2] = await Promise.all([
      consolidacaoWorker.consolidarLote(loteId, usuarioId),
      consolidacaoWorker.consolidarLote(loteId, usuarioId),
    ]);

    // Verifica que exatamente 1 movimento foi criado no banco para essa despesa
    const movimentosSalvos = await prisma.movimento.findMany({
      where: {
        usuarioId,
        descricao: desc,
      },
    });

    expect(movimentosSalvos.length).toBe(1);

    // O total combinado de duplicadas ignoradas deve ser pelo menos 1
    const totalDuplicadas = res1.duplicadasIgnoradas + res2.duplicadasIgnoradas;
    expect(totalDuplicadas).toBeGreaterThanOrEqual(1);

    // Na tabela de staging, 1 deve ser PROCESSADO e 1 deve ser IGNORADO
    const stagings = await prisma.stagingLancamentoImportacao.findMany({
      where: { loteId, descricao: desc },
    });
    const statusCount = stagings.map((s) => s.statusProcessamento).sort();
    expect(statusCount).toEqual(['IGNORADO', 'PROCESSADO']);
  });
});
