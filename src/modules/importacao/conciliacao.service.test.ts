import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../infrastructure/database/prisma.js';
import { conciliacaoService } from './conciliacao.service.js';
import { TipoDocumentoImportado, TipoAlertaConciliacao, StatusAlertaConciliacao } from '@prisma/client';

describe('TASK-41: ConciliacaoService - Histórico Estruturado e Alertas de Lacunas', () => {
  let usuarioId: string;
  let contaCartaoId: string;

  beforeEach(async () => {
    // Cria usuário de teste com isolamento multi-tenant
    const user = await prisma.usuario.create({
      data: {
        nome: 'Usuario Teste Conciliacao',
        email: `teste_conciliacao_${Date.now()}_${Math.random()}@evolvi.app`,
        senhaHash: 'hash123',
      },
    });
    usuarioId = user.id;

    // Cria conta de Cartão de Crédito com monitoramento ativo
    const conta = await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Cartão Nubank Teste',
        tipo: 'CARTAO_CREDITO',
        diaVencimento: 15,
        ativo: true,
        monitorarConciliacao: true,
      },
    });
    contaCartaoId = conta.id;
  });

  it('deve catalogar arquivo com sucesso em HistoricoImportacaoArquivo', async () => {
    const lote = await prisma.loteImportacao.create({
      data: {
        usuarioId,
        caminhoDiretorio: 'test-catalog',
      },
    });

    const arquivo = await prisma.arquivoImportacao.create({
      data: {
        loteId: lote.id,
        nomeArquivo: 'Fatura_Nubank_2026-01.pdf',
        caminhoRelativo: 'Fatura_Nubank_2026-01.pdf',
        status: 'PROCESSADO_FINAL',
      },
    });

    await prisma.stagingLancamentoImportacao.create({
      data: {
        loteId: lote.id,
        arquivoId: arquivo.id,
        arquivoOrigem: arquivo.nomeArquivo,
        dataMovimento: new Date('2026-01-10T12:00:00Z'),
        descricao: 'Compra Mercado',
        valor: 150.0,
        natureza: 'DESPESA',
        contaSugerida: 'Cartão Nubank Teste',
        statusProcessamento: 'PROCESSADO',
      },
    });

    const historico = await conciliacaoService.catalogarArquivo({
      usuarioId,
      arquivoId: arquivo.id,
      loteId: lote.id,
    });

    expect(historico).toBeDefined();
    expect(historico.tipoDocumento).toBe(TipoDocumentoImportado.FATURA_CARTAO);
    expect(historico.instituicao).toBe('Nubank');
    expect(historico.competencia).toBe('2026-01');
    expect(historico.totalTransacoes).toBe(1);
    expect(Number(historico.valorTotal)).toBe(150.0);
  });

  it('deve detectar lacuna temporal e gerar alerta pendente quando falta um mês intermediário', async () => {
    const lote = await prisma.loteImportacao.create({
      data: {
        usuarioId,
        caminhoDiretorio: 'test-lacuna',
      },
    });

    // Arquivo 1: Jan/2026
    const arqJan = await prisma.arquivoImportacao.create({
      data: { loteId: lote.id, nomeArquivo: 'Fatura_Nubank_2026-01.pdf', caminhoRelativo: 'Fatura_Nubank_2026-01.pdf', status: 'PROCESSADO_FINAL' },
    });
    await prisma.stagingLancamentoImportacao.create({
      data: {
        loteId: lote.id,
        arquivoId: arqJan.id,
        arquivoOrigem: arqJan.nomeArquivo,
        dataMovimento: new Date('2026-01-15T12:00:00Z'),
        descricao: 'Gasto Jan',
        valor: 100.0,
        natureza: 'DESPESA',
        contaSugerida: 'Cartão Nubank Teste',
        statusProcessamento: 'PROCESSADO',
      },
    });
    await conciliacaoService.catalogarArquivo({ usuarioId, arquivoId: arqJan.id, loteId: lote.id });

    // Arquivo 2: Mar/2026 (pulando Fev/2026!)
    const arqMar = await prisma.arquivoImportacao.create({
      data: { loteId: lote.id, nomeArquivo: 'Fatura_Nubank_2026-03.pdf', caminhoRelativo: 'Fatura_Nubank_2026-03.pdf', status: 'PROCESSADO_FINAL' },
    });
    await prisma.stagingLancamentoImportacao.create({
      data: {
        loteId: lote.id,
        arquivoId: arqMar.id,
        arquivoOrigem: arqMar.nomeArquivo,
        dataMovimento: new Date('2026-03-15T12:00:00Z'),
        descricao: 'Gasto Mar',
        valor: 200.0,
        natureza: 'DESPESA',
        contaSugerida: 'Cartão Nubank Teste',
        statusProcessamento: 'PROCESSADO',
      },
    });
    await conciliacaoService.catalogarArquivo({ usuarioId, arquivoId: arqMar.id, loteId: lote.id });

    // Verifica se gerou alerta para 2026-02
    const alertas = await conciliacaoService.listarAlertas(usuarioId);
    expect(alertas.length).toBe(1);
    expect(alertas[0].competencia).toBe('2026-02');
    expect(alertas[0].tipoAlerta).toBe(TipoAlertaConciliacao.FATURA_NAO_IMPORTADA);
    expect(alertas[0].status).toBe(StatusAlertaConciliacao.PENDENTE);
    expect(alertas[0].contaId).toBe(contaCartaoId);
  });

  it('deve auto-resolver o alerta quando o mês faltante for posteriormente importado', async () => {
    const lote = await prisma.loteImportacao.create({
      data: { usuarioId, caminhoDiretorio: 'test-auto-resolve' },
    });

    // Cria Jan e Mar
    const arqJan = await prisma.arquivoImportacao.create({
      data: { loteId: lote.id, nomeArquivo: 'Fatura_Nubank_2026-01.pdf', caminhoRelativo: 'Fatura_Nubank_2026-01.pdf', status: 'PROCESSADO_FINAL' },
    });
    await prisma.stagingLancamentoImportacao.create({
      data: {
        loteId: lote.id,
        arquivoId: arqJan.id,
        arquivoOrigem: arqJan.nomeArquivo,
        dataMovimento: new Date('2026-01-15T12:00:00Z'),
        descricao: 'Jan',
        valor: 50,
        natureza: 'DESPESA',
        contaSugerida: 'Cartão Nubank Teste',
        statusProcessamento: 'PROCESSADO',
      },
    });
    await conciliacaoService.catalogarArquivo({ usuarioId, arquivoId: arqJan.id, loteId: lote.id });

    const arqMar = await prisma.arquivoImportacao.create({
      data: { loteId: lote.id, nomeArquivo: 'Fatura_Nubank_2026-03.pdf', caminhoRelativo: 'Fatura_Nubank_2026-03.pdf', status: 'PROCESSADO_FINAL' },
    });
    await prisma.stagingLancamentoImportacao.create({
      data: {
        loteId: lote.id,
        arquivoId: arqMar.id,
        arquivoOrigem: arqMar.nomeArquivo,
        dataMovimento: new Date('2026-03-15T12:00:00Z'),
        descricao: 'Mar',
        valor: 80,
        natureza: 'DESPESA',
        contaSugerida: 'Cartão Nubank Teste',
        statusProcessamento: 'PROCESSADO',
      },
    });
    await conciliacaoService.catalogarArquivo({ usuarioId, arquivoId: arqMar.id, loteId: lote.id });

    let alertas = await conciliacaoService.listarAlertas(usuarioId);
    expect(alertas.length).toBe(1);
    expect(alertas[0].status).toBe(StatusAlertaConciliacao.PENDENTE);

    // Agora importa o mês faltante: Fev/2026
    const arqFev = await prisma.arquivoImportacao.create({
      data: { loteId: lote.id, nomeArquivo: 'Fatura_Nubank_2026-02.pdf', caminhoRelativo: 'Fatura_Nubank_2026-02.pdf', status: 'PROCESSADO_FINAL' },
    });
    await prisma.stagingLancamentoImportacao.create({
      data: {
        loteId: lote.id,
        arquivoId: arqFev.id,
        arquivoOrigem: arqFev.nomeArquivo,
        dataMovimento: new Date('2026-02-15T12:00:00Z'),
        descricao: 'Fev recuperado',
        valor: 120,
        natureza: 'DESPESA',
        contaSugerida: 'Cartão Nubank Teste',
        statusProcessamento: 'PROCESSADO',
      },
    });
    await conciliacaoService.catalogarArquivo({ usuarioId, arquivoId: arqFev.id, loteId: lote.id });

    // Alertas pendentes devem estar zerados
    const alertasPendentes = await conciliacaoService.listarAlertas(usuarioId, StatusAlertaConciliacao.PENDENTE);
    expect(alertasPendentes.length).toBe(0);

    // O alerta anterior agora deve estar RESOLVIDO
    const alertasResolvidos = await conciliacaoService.listarAlertas(usuarioId, StatusAlertaConciliacao.RESOLVIDO);
    expect(alertasResolvidos.length).toBe(1);
    expect(alertasResolvidos[0].competencia).toBe('2026-02');
  });

  it('deve permitir dispensar alerta manualmente e inativar monitoramento se motivo for CONTA_ENCERRADA', async () => {
    // Cria alerta pendente
    const alerta = await prisma.alertaConciliacao.create({
      data: {
        usuarioId,
        contaId: contaCartaoId,
        tipoAlerta: TipoAlertaConciliacao.FATURA_NAO_IMPORTADA,
        titulo: 'Fatura Nubank Faltante',
        descricao: 'Faltando mês 2026-02',
        competencia: '2026-02',
        status: StatusAlertaConciliacao.PENDENTE,
      },
    });

    const dispensado = await conciliacaoService.dispensarAlerta({
      usuarioId,
      alertaId: alerta.id,
      motivoDispensa: 'CONTA_ENCERRADA',
    });

    expect(dispensado.status).toBe(StatusAlertaConciliacao.DISPENSADO);
    expect(dispensado.motivoDispensa).toBe('CONTA_ENCERRADA');

    // A conta deve ter sido inativada para não gerar alertas no futuro
    const contaAtualizada = await prisma.conta.findUnique({
      where: { id: contaCartaoId },
    });
    expect(contaAtualizada?.monitorarConciliacao).toBe(false);
    expect(contaAtualizada?.ativo).toBe(false);
  });
});
