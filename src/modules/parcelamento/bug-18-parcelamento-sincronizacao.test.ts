import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../infrastructure/database/prisma.js';
import { parcelamentoSincronizacaoWorkerService } from './parcelamento-sincronizacao-worker.service.js';
import { ParcelamentoSincronizacaoService } from './parcelamento-sincronizacao.service.js';
import { importacaoConsolidacaoWorkerService } from '../importacao/worker/importacao-consolidacao-worker.service.js';
import { authEventBus } from '../../infrastructure/events/auth-event-bus.js';
import { importacaoEventBus } from '../../infrastructure/events/importacao-event-bus.js';

describe('BUG-18: Investigação e Saneamento Automatizado de Parcelamentos Expirados e Duplicados', () => {
  let usuarioId: string;
  let outroUsuarioId: string;
  let contaCartaoId: string;
  let contaOutroId: string;

  beforeAll(async () => {
    // 1. Criar usuário de teste principal
    const usuario = await prisma.usuario.create({
      data: {
        nome: 'Usuario Bug 18 Test',
        email: `test-bug-18-${Date.now()}@evolvi.app`,
        senhaHash: 'hash123',
      },
    });
    usuarioId = usuario.id;

    // 2. Outro usuário para garantir isolamento multi-tenant
    const outroUsuario = await prisma.usuario.create({
      data: {
        nome: 'Outro Usuario MultiTenant',
        email: `outro-bug-18-${Date.now()}@evolvi.app`,
        senhaHash: 'hash123',
      },
    });
    outroUsuarioId = outroUsuario.id;

    // 3. Contas de cartão de crédito
    const contaCartao = await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Cartão C6 Bank',
        tipo: 'CARTAO_CREDITO',
        diaVencimento: 10,
      },
    });
    contaCartaoId = contaCartao.id;

    const contaOutro = await prisma.conta.create({
      data: {
        usuarioId: outroUsuarioId,
        nome: 'Cartão Nubank',
        tipo: 'CARTAO_CREDITO',
        diaVencimento: 5,
      },
    });
    contaOutroId = contaOutro.id;
  });

  afterAll(async () => {
    // Limpeza em cascata
    await prisma.parcelamento.deleteMany({
      where: { usuarioId: { in: [usuarioId, outroUsuarioId] } },
    });
    await prisma.movimento.deleteMany({
      where: { usuarioId: { in: [usuarioId, outroUsuarioId] } },
    });
    await prisma.conta.deleteMany({
      where: { usuarioId: { in: [usuarioId, outroUsuarioId] } },
    });
    await prisma.usuario.deleteMany({
      where: { id: { in: [usuarioId, outroUsuarioId] } },
    });
    parcelamentoSincronizacaoWorkerService.removeEventListener();
  });

  it('1. Deve auto-quitar parcelamentos expirados com base na competência corrente', async () => {
    // Cria um parcelamento de 2 parcelas que terminou em 2026-02 (ex: Clínica Veterinária)
    const parcExpirado = await prisma.parcelamento.create({
      data: {
        usuarioId,
        contaId: contaCartaoId,
        descricao: 'CLINICA VETERINARIA DR',
        valorTotal: 260.0,
        parcelaValor: 130.0,
        parcelaAtual: 1,
        totalParcelas: 2,
        primeiroVencimento: '2026-01',
        ultimoVencimento: '2026-02',
        status: 'ATIVO',
      },
    });

    // Executa a sincronização para a competência de 2026-10
    const res = await ParcelamentoSincronizacaoService.sincronizarParaUsuario(usuarioId, '2026-10');
    expect(res.totalQuitados).toBeGreaterThanOrEqual(1);

    const atualizado = await prisma.parcelamento.findUnique({
      where: { id: parcExpirado.id },
    });
    expect(atualizado?.status).toBe('QUITADO');
    expect(atualizado?.parcelaAtual).toBe(2);
  });

  it('2. Deve avançar parcelaAtual se o contrato ainda estiver vigente', async () => {
    // Compra em 2026-08 de 10 parcelas (termina em 2027-05)
    // Em 2026-10, passaram-se 3 meses (2026-08 = parc 1, 2026-09 = parc 2, 2026-10 = parc 3)
    const parcVigente = await prisma.parcelamento.create({
      data: {
        usuarioId,
        contaId: contaCartaoId,
        descricao: 'GELADEIRA FROST FREE',
        valorTotal: 3000.0,
        parcelaValor: 300.0,
        parcelaAtual: 1,
        totalParcelas: 10,
        primeiroVencimento: '2026-08',
        ultimoVencimento: '2027-05',
        status: 'ATIVO',
      },
    });

    const res = await ParcelamentoSincronizacaoService.sincronizarParaUsuario(usuarioId, '2026-10');
    expect(res.totalParcelasAvancadas).toBeGreaterThanOrEqual(1);

    const atualizado = await prisma.parcelamento.findUnique({
      where: { id: parcVigente.id },
    });
    expect(atualizado?.status).toBe('ATIVO');
    expect(atualizado?.parcelaAtual).toBe(3);
  });

  it('3. Deve deduplicar contratos fracionados gerados por faturas mensais da mesma compra', async () => {
    // Simula 2 registros fragmentados para a mesma compra parcelada de 3 parcelas
    const frag1 = await prisma.parcelamento.create({
      data: {
        usuarioId,
        contaId: contaCartaoId,
        descricao: 'AMAZON BRASIL - Parcela 1/3',
        valorTotal: 300.0,
        parcelaValor: 100.0,
        parcelaAtual: 1,
        totalParcelas: 3,
        primeiroVencimento: '2026-09',
        ultimoVencimento: '2026-11',
        status: 'ATIVO',
      },
    });

    const frag2 = await prisma.parcelamento.create({
      data: {
        usuarioId,
        contaId: contaCartaoId,
        descricao: 'AMAZON BRASIL - Parcela 2/3',
        valorTotal: 300.0,
        parcelaValor: 100.0,
        parcelaAtual: 2,
        totalParcelas: 3,
        primeiroVencimento: '2026-10',
        ultimoVencimento: '2026-12',
        status: 'ATIVO',
      },
    });

    const res = await ParcelamentoSincronizacaoService.sincronizarParaUsuario(usuarioId, '2026-10');
    expect(res.totalDeduplicados).toBeGreaterThanOrEqual(1);

    // O fragmento 2 deve ter sido excluído e o fragmento 1 unificado com descricao limpa e maior parcela
    const existeFrag2 = await prisma.parcelamento.findUnique({
      where: { id: frag2.id },
    });
    expect(existeFrag2).toBeNull();

    const unificado = await prisma.parcelamento.findUnique({
      where: { id: frag1.id },
    });
    expect(unificado).not.toBeNull();
    expect(unificado?.descricao).toBe('AMAZON BRASIL');
    expect(unificado?.parcelaAtual).toBe(2);
  });

  it('4. Deve executar saneamento via gatilho de login (authEventBus) com isolamento multi-tenant', async () => {
    // Cria parcelamento expirado para o outro usuário
    const parcOutro = await prisma.parcelamento.create({
      data: {
        usuarioId: outroUsuarioId,
        contaId: contaOutroId,
        descricao: 'COMPRA OUTRO USUARIO - Parcela 1/2',
        valorTotal: 100.0,
        parcelaValor: 50.0,
        parcelaAtual: 1,
        totalParcelas: 2,
        primeiroVencimento: '2026-01',
        ultimoVencimento: '2026-02',
        status: 'ATIVO',
      },
    });

    parcelamentoSincronizacaoWorkerService.setupEventListener();

    // Emite evento de login apenas para usuarioId principal
    authEventBus.emitUsuarioAutenticado({
      usuarioId,
      email: 'test-bug-18@evolvi.app',
      timestamp: new Date(),
    });

    // Aguarda o worker assíncrono processar
    await new Promise((resolve) => setTimeout(resolve, 300));

    // O contrato do outro usuário NÃO deve ter sido modificado (isolamento multi-tenant estrito)
    const parcOutroInalterado = await prisma.parcelamento.findUnique({
      where: { id: parcOutro.id },
    });
    expect(parcOutroInalterado?.status).toBe('ATIVO');
    expect(parcOutroInalterado?.parcelaAtual).toBe(1);
  });

  it('5. Worker de consolidação de importação deve deduplicar inteligentemente por prefixoBase', async () => {
    // Cria lote de importação com staging de 2 parcelas sequenciais da mesma compra
    const lote = await prisma.loteImportacao.create({
      data: {
        usuarioId,
        caminhoDiretorio: '/tmp/test-c6',
        totalArquivos: 1,
        status: 'CONCLUIDO',
      },
    });

    const arquivo = await prisma.arquivoImportacao.create({
      data: {
        loteId: lote.id,
        nomeArquivo: 'fatura_c6_teste.pdf',
        caminhoRelativo: 'fatura_c6_teste.pdf',
        mimeType: 'application/pdf',
        status: 'STAGING_CARREGADO',
      },
    });

    // 1º item: Parcela 1/3 importada em 2026-08
    await prisma.stagingLancamentoImportacao.create({
      data: {
        loteId: lote.id,
        arquivoId: arquivo.id,
        arquivoOrigem: 'fatura_c6_teste.pdf',
        dataMovimento: new Date('2026-08-10T12:00:00Z'),
        descricao: 'MAGALU ELETRO - Parcela 1/3',
        valor: 150.0,
        natureza: 'DESPESA',
        tipoConta: 'CARTAO_CREDITO',
        contaSugerida: 'Cartão C6 Bank',
        parcelaAtual: 1,
        totalParcelas: 3,
        statusProcessamento: 'PENDENTE',
      },
    });

    // Desativa temporariamente o listener de lote concluído para testar a consolidação passo a passo
    parcelamentoSincronizacaoWorkerService.removeEventListener();

    await importacaoConsolidacaoWorkerService.consolidarLote(lote.id, usuarioId);

    // Verifica que 1 parcelamento foi criado
    const parcCriado = await prisma.parcelamento.findFirst({
      where: { usuarioId, descricao: 'MAGALU ELETRO' },
    });
    expect(parcCriado).not.toBeNull();
    expect(parcCriado?.parcelaAtual).toBe(1);
    expect(parcCriado?.primeiroVencimento).toBe('2026-08');
    expect(parcCriado?.ultimoVencimento).toBe('2026-10');

    // 2º item: Parcela 2/3 importada na fatura do mês seguinte (2026-09)
    await prisma.stagingLancamentoImportacao.create({
      data: {
        loteId: lote.id,
        arquivoId: arquivo.id,
        arquivoOrigem: 'fatura_c6_teste.pdf',
        dataMovimento: new Date('2026-09-10T12:00:00Z'),
        descricao: 'MAGALU ELETRO - Parcela 2/3',
        valor: 150.0,
        natureza: 'DESPESA',
        tipoConta: 'CARTAO_CREDITO',
        contaSugerida: 'Cartão C6 Bank',
        parcelaAtual: 2,
        totalParcelas: 3,
        statusProcessamento: 'PENDENTE',
      },
    });

    await importacaoConsolidacaoWorkerService.consolidarLote(lote.id, usuarioId);

    // Não deve criar um novo contrato; deve atualizar o existente para parcelaAtual 2
    const totalParcsMagalu = await prisma.parcelamento.count({
      where: { usuarioId, descricao: 'MAGALU ELETRO' },
    });
    expect(totalParcsMagalu).toBe(1);

    const parcAtualizado = await prisma.parcelamento.findFirst({
      where: { usuarioId, descricao: 'MAGALU ELETRO' },
    });
    expect(parcAtualizado?.parcelaAtual).toBe(2);
    expect(parcAtualizado?.status).toBe('ATIVO');

    // 3º item: Parcela 3/3 importada em 2026-10 (última parcela)
    await prisma.stagingLancamentoImportacao.create({
      data: {
        loteId: lote.id,
        arquivoId: arquivo.id,
        arquivoOrigem: 'fatura_c6_teste.pdf',
        dataMovimento: new Date('2026-10-10T12:00:00Z'),
        descricao: 'MAGALU ELETRO - Parcela 3/3',
        valor: 150.0,
        natureza: 'DESPESA',
        tipoConta: 'CARTAO_CREDITO',
        contaSugerida: 'Cartão C6 Bank',
        parcelaAtual: 3,
        totalParcelas: 3,
        statusProcessamento: 'PENDENTE',
      },
    });

    await importacaoConsolidacaoWorkerService.consolidarLote(lote.id, usuarioId);

    const parcFinal = await prisma.parcelamento.findFirst({
      where: { usuarioId, descricao: 'MAGALU ELETRO' },
    });
    expect(parcFinal?.parcelaAtual).toBe(3);
    expect(parcFinal?.status).toBe('QUITADO');

    // Limpar lote de teste
    await prisma.stagingLancamentoImportacao.deleteMany({ where: { loteId: lote.id } });
    await prisma.movimento.deleteMany({ where: { usuarioId } });
    await prisma.arquivoImportacao.deleteMany({ where: { loteId: lote.id } });
    await prisma.loteImportacao.delete({ where: { id: lote.id } });
  });

  it('6. Deve lançar parcelas futuras com status PREVISTO para competências subsequentes (ex: Novembro)', async () => {
    // Cria um parcelamento ativo com 1 de 2 em 2026-10 (vencendo parcela 2 em 2026-11)
    const parcAtivo2x = await prisma.parcelamento.create({
      data: {
        usuarioId,
        contaId: contaCartaoId,
        descricao: 'SUPERMERCADO CENTRAL',
        valorTotal: 500.0,
        parcelaValor: 250.0,
        parcelaAtual: 1,
        totalParcelas: 2,
        primeiroVencimento: '2026-10',
        ultimoVencimento: '2026-11',
        status: 'ATIVO',
      },
    });

    // Cria o movimento oficial da parcela 1/2 em 2026-10
    await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: contaCartaoId,
        dataMovimento: new Date('2026-10-10T00:00:00.000Z'),
        competencia: '2026-10',
        descricao: 'SUPERMERCADO CENTRAL - Parcela 1/2',
        valor: 250.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        chaveDedupe: 'TEST_PARC_1_2',
      },
    });

    // Executa a sincronização para a competência de 2026-10
    await ParcelamentoSincronizacaoService.sincronizarParaUsuario(usuarioId, '2026-10');

    // Em novembro de 2026 (2026-11), a parcela 2 de 2 deve existir como PREVISTO
    const movNov = await prisma.movimento.findFirst({
      where: {
        usuarioId,
        competencia: '2026-11',
        descricao: { contains: 'SUPERMERCADO CENTRAL' },
      },
    });

    expect(movNov).toBeDefined();
    expect(movNov?.status).toBe('PREVISTO');
    expect(movNov?.descricao).toBe('SUPERMERCADO CENTRAL - Parcela 2/2');
    expect(Number(movNov?.valor)).toBe(250.0);

    // Limpeza
    await prisma.movimento.deleteMany({ where: { usuarioId } });
    await prisma.parcelamento.deleteMany({ where: { id: parcAtivo2x.id } });
  });
});
