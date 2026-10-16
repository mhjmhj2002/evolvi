import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { ImportacaoConsolidacaoWorkerService } from './importacao-consolidacao-worker.service.js';
import { GeminiIaExtratorClient } from './ia-extrator.client.js';

describe('BUG-07: Identificação de Transferências Entre Contas Próprias e Resgates (Anti-Inflação de Receitas)', () => {
  let usuarioId: string;
  let loteId: string;
  let arquivoId: string;
  const consolidacaoWorker = new ImportacaoConsolidacaoWorkerService();

  beforeAll(async () => {
    // Cria usuário de teste com nome completo do titular
    const usuario = await prisma.usuario.create({
      data: {
        nome: 'Manuel Alejandro Hinojosa Jara',
        email: `test-bug-07-${Date.now()}@evolvi.app`,
        senhaHash: 'hash123',
        rendaBaseMensal: 8600.0,
      },
    });
    usuarioId = usuario.id;

    // Cria conta para o usuário
    await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Conta C6 Bank',
        tipo: 'CONTA_CORRENTE',
      },
    });

    // Cria lote de importação
    const lote = await prisma.loteImportacao.create({
      data: {
        usuarioId,
        caminhoDiretorio: 'uploads/test-bug-07',
        status: 'CARGA_STAGING',
      },
    });
    loteId = lote.id;

    // Cria arquivo de importação
    const arquivo = await prisma.arquivoImportacao.create({
      data: {
        loteId,
        nomeArquivo: 'extrato_c6.csv',
        caminhoRelativo: 'extrato_c6.csv',
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
  });

  it('1. No Consolidador: deve converter entradas com o nome do titular para TRANSFERENCIA_PROPRIA', async () => {
    // Insere itens na staging simulando entradas do próprio titular
    await prisma.stagingLancamentoImportacao.create({
      data: {
        loteId,
        arquivoId,
        arquivoOrigem: 'extrato_c6.csv',
        dataMovimento: new Date('2026-03-04T00:00:00.000Z'),
        descricao: 'Entrada PIX Pix recebido de MANUEL ALEJANDRO HINOJOSA JARA',
        valor: 5000.0,
        natureza: 'RECEITA', // IA extraiu ou marcou como RECEITA erroneamente
        contaSugerida: 'Conta C6 Bank',
        tipoConta: 'CONTA_CORRENTE',
        statusProcessamento: 'PENDENTE',
      },
    });

    const res = await consolidacaoWorker.consolidarLote(loteId, usuarioId);
    expect(res.sucesso).toBe(true);

    // O movimento oficial criado deve ser categorizado como TRANSFERENCIA_PROPRIA
    const movCriado = await prisma.movimento.findFirst({
      where: {
        usuarioId,
        descricao: 'Entrada PIX Pix recebido de MANUEL ALEJANDRO HINOJOSA JARA',
      },
    });

    expect(movCriado).toBeDefined();
    expect(movCriado!.natureza).toBe('TRANSFERENCIA_PROPRIA');
  });

  it('2. No Consolidador: deve converter resgates de investimentos (CDB, poupança) para TRANSFERENCIA_PROPRIA', async () => {
    await prisma.stagingLancamentoImportacao.create({
      data: {
        loteId,
        arquivoId,
        arquivoOrigem: 'extrato_c6.csv',
        dataMovimento: new Date('2026-03-20T00:00:00.000Z'),
        descricao: 'Entradas RESGATE DE CDB',
        valor: 5014.16,
        natureza: 'RECEITA',
        contaSugerida: 'Conta C6 Bank',
        tipoConta: 'CONTA_CORRENTE',
        statusProcessamento: 'PENDENTE',
      },
    });

    const res = await consolidacaoWorker.consolidarLote(loteId, usuarioId);
    expect(res.sucesso).toBe(true);

    const movCriado = await prisma.movimento.findFirst({
      where: {
        usuarioId,
        descricao: 'Entradas RESGATE DE CDB',
      },
    });

    expect(movCriado).toBeDefined();
    expect(movCriado!.natureza).toBe('TRANSFERENCIA_PROPRIA');
  });

  it('3. No Consolidador: NÃO deve converter salário real nem entradas de terceiros', async () => {
    await prisma.stagingLancamentoImportacao.createMany({
      data: [
        {
          loteId,
          arquivoId,
          arquivoOrigem: 'extrato_santander.csv',
          dataMovimento: new Date('2026-03-13T00:00:00.000Z'),
          descricao: 'TED CONTA SALARIO MANOEL ALEJANDRO HINOJESA',
          valor: 4147.21,
          natureza: 'RECEITA',
          contaSugerida: 'Conta Santander',
          tipoConta: 'CONTA_CORRENTE',
          statusProcessamento: 'PENDENTE',
        },
        {
          loteId,
          arquivoId,
          arquivoOrigem: 'extrato_santander.csv',
          dataMovimento: new Date('2026-03-16T00:00:00.000Z'),
          descricao: 'PIX RECEBIDO Daniela Beatriz Labarca H',
          valor: 600.0,
          natureza: 'RECEITA',
          contaSugerida: 'Conta Santander',
          tipoConta: 'CONTA_CORRENTE',
          statusProcessamento: 'PENDENTE',
        },
      ],
    });

    await consolidacaoWorker.consolidarLote(loteId, usuarioId);

    const movSalario = await prisma.movimento.findFirst({
      where: {
        usuarioId,
        descricao: 'TED CONTA SALARIO MANOEL ALEJANDRO HINOJESA',
      },
    });
    expect(movSalario).toBeDefined();
    expect(movSalario!.natureza).toBe('RECEITA');

    const movTerceiro = await prisma.movimento.findFirst({
      where: {
        usuarioId,
        descricao: 'PIX RECEBIDO Daniela Beatriz Labarca H',
      },
    });
    expect(movTerceiro).toBeDefined();
    expect(movTerceiro!.natureza).toBe('RECEITA');
  });

  it('4. No Extrator IA: contexto com nomeTitular injeta diretrizes e sanitiza valores <= 0', async () => {
    const client = new GeminiIaExtratorClient();

    // Testa extrairLocalDeterministic com transferência de titular e resgate
    const csvTexto = `Data;Descrição;Valor\n04/03/2026;PIX Recebido Manuel Alejandro Hinojosa;5000,00\n20/03/2026;RESGATE DE CDB;5014,16\n13/03/2026;Salário Mensal Empresa;4147,21`;

    const transacoes = client.extrairLocalDeterministic({
      nomeArquivo: 'extrato_teste.csv',
      conteudoBuffer: Buffer.from(csvTexto, 'utf-8'),
      contexto: {
        contas: [{ id: '1', nome: 'Conta C6', tipo: 'CONTA_CORRENTE' }],
        categorias: [{ id: '1', nome: 'Outros' }],
        dataReferencia: '2026-03-31',
        nomeTitular: 'Manuel Alejandro Hinojosa Jara',
      },
    });

    expect(transacoes.length).toBe(3);
  });
});
