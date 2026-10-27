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

  it('deve auto-resolver alerta ao catalogar arquivo com contaId explícito e reprocessar fluxo', async () => {
    // 1. Cria alerta pendente para a conta e competência 2026-04
    const alerta = await prisma.alertaConciliacao.create({
      data: {
        usuarioId,
        contaId: contaCartaoId,
        tipoAlerta: TipoAlertaConciliacao.FATURA_NAO_IMPORTADA,
        titulo: 'Fatura Abril Faltante',
        descricao: 'Não localizamos fatura 2026-04',
        competencia: '2026-04',
        status: StatusAlertaConciliacao.PENDENTE,
      },
    });

    // 2. Simula importação de arquivo com contaId explicitamente associado
    const lote = await prisma.loteImportacao.create({
      data: { usuarioId, caminhoDiretorio: 'test-conta-explicita' },
    });
    const arq = await prisma.arquivoImportacao.create({
      data: {
        loteId: lote.id,
        nomeArquivo: 'extrato_generico.csv',
        caminhoRelativo: 'extrato_generico.csv',
        status: 'PROCESSADO_FINAL',
      },
    });
    await prisma.stagingLancamentoImportacao.create({
      data: {
        loteId: lote.id,
        arquivoId: arq.id,
        arquivoOrigem: arq.nomeArquivo,
        dataMovimento: new Date('2026-04-10T12:00:00Z'),
        descricao: 'Compra Mercado Abril',
        valor: 110,
        natureza: 'DESPESA',
        statusProcessamento: 'PROCESSADO',
      },
    });

    await conciliacaoService.catalogarArquivo({
      usuarioId,
      arquivoId: arq.id,
      loteId: lote.id,
      contaId: contaCartaoId,
    });

    // 3. O alerta deve ter sido resolvido e saído da fila pendente
    const alertaApos = await prisma.alertaConciliacao.findUnique({
      where: { id: alerta.id },
    });
    expect(alertaApos?.status).toBe(StatusAlertaConciliacao.RESOLVIDO);
    expect(alertaApos?.resolvidoEm).toBeDefined();

    const pendentes = await conciliacaoService.listarAlertas(usuarioId, StatusAlertaConciliacao.PENDENTE);
    expect(pendentes.some((a) => a.id === alerta.id)).toBe(false);
  });

  it('deve auto-resolver alertas de meses intermediários com arquivo de extrato multimês', async () => {
    // 1. Cria alerta pendente para mês intermediário (2026-04)
    const alertaAbril = await prisma.alertaConciliacao.create({
      data: {
        usuarioId,
        contaId: contaCartaoId,
        tipoAlerta: TipoAlertaConciliacao.FATURA_NAO_IMPORTADA,
        titulo: 'Fatura Abril Faltante',
        descricao: 'Não localizamos fatura 2026-04',
        competencia: '2026-04',
        status: StatusAlertaConciliacao.PENDENTE,
      },
    });

    // 2. Importa arquivo cujo período cobre de 2026-01 a 2026-09
    const lote = await prisma.loteImportacao.create({
      data: { usuarioId, caminhoDiretorio: 'test-multimes' },
    });
    const arq = await prisma.arquivoImportacao.create({
      data: {
        loteId: lote.id,
        nomeArquivo: 'Extrato_Anual_Nubank.csv',
        caminhoRelativo: 'Extrato_Anual_Nubank.csv',
        status: 'PROCESSADO_FINAL',
      },
    });
    // Staging 1 em janeiro
    await prisma.stagingLancamentoImportacao.create({
      data: {
        loteId: lote.id,
        arquivoId: arq.id,
        arquivoOrigem: arq.nomeArquivo,
        dataMovimento: new Date('2026-01-10T12:00:00Z'),
        descricao: 'Lancamento Jan',
        valor: 100,
        natureza: 'DESPESA',
        contaSugerida: 'Cartão Nubank Teste',
        statusProcessamento: 'PROCESSADO',
      },
    });
    // Staging 2 em setembro
    await prisma.stagingLancamentoImportacao.create({
      data: {
        loteId: lote.id,
        arquivoId: arq.id,
        arquivoOrigem: arq.nomeArquivo,
        dataMovimento: new Date('2026-09-15T12:00:00Z'),
        descricao: 'Lancamento Set',
        valor: 200,
        natureza: 'DESPESA',
        contaSugerida: 'Cartão Nubank Teste',
        statusProcessamento: 'PROCESSADO',
      },
    });

    await conciliacaoService.catalogarArquivo({
      usuarioId,
      arquivoId: arq.id,
      loteId: lote.id,
      contaId: contaCartaoId,
    });

    // O alerta de 2026-04 deve estar RESOLVIDO mesmo a competência final sendo 2026-09
    const alertaApos = await prisma.alertaConciliacao.findUnique({
      where: { id: alertaAbril.id },
    });
    expect(alertaApos?.status).toBe(StatusAlertaConciliacao.RESOLVIDO);
    expect(alertaApos?.resolvidoEm).toBeDefined();
  });

  it('deve auto-resolver alerta de conta similar/equivalente que possui movimentos na competência', async () => {
    // 1. Cria conta 1 "Banco Inter" e conta 2 "Inter" (com número de conta)
    const contaBancoInter = await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Banco Inter',
        tipo: 'CONTA_CORRENTE',
        ativo: true,
        monitorarConciliacao: true,
      },
    });

    const contaInter = await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Inter',
        tipo: 'CONTA_CORRENTE',
        numeroConta: '12345678',
        ativo: true,
        monitorarConciliacao: true,
      },
    });

    // 2. Cria alerta vinculado a contaBancoInter
    const alerta = await prisma.alertaConciliacao.create({
      data: {
        usuarioId,
        contaId: contaBancoInter.id,
        tipoAlerta: TipoAlertaConciliacao.EXTRATO_LACUNA_TEMPORAL,
        titulo: 'Extrato com Lacuna: Banco Inter (2026-04)',
        descricao: 'Falta extrato',
        competencia: '2026-04',
        status: StatusAlertaConciliacao.PENDENTE,
      },
    });

    // 3. Insere movimento consolidado em contaInter para 2026-04
    await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: contaInter.id,
        dataMovimento: new Date('2026-04-10T12:00:00Z'),
        competencia: '2026-04',
        descricao: 'Compra Mercado Débito',
        valor: 50,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
      },
    });

    // 4. Executa verificarLacunas
    await conciliacaoService.verificarLacunas(usuarioId);

    const alertaAtualizado = await prisma.alertaConciliacao.findUnique({
      where: { id: alerta.id },
    });
    expect(alertaAtualizado?.status).toBe(StatusAlertaConciliacao.RESOLVIDO);
    expect(alertaAtualizado?.resolvidoEm).toBeDefined();
  });

  it('deve extrair com sucesso o período formal do extrato a partir do cabeçalho ou nome de arquivo', () => {
    // 1. Cabeçalho explícito "Período de DD/MM/AAAA a DD/MM/AAAA"
    const p1 = conciliacaoService.extrairPeriodoDocumento(
      'Extrato Neon\nPeríodo de 31/12/2025 a 16/09/2026\nDescrição...',
      'Extrato.pdf'
    );
    expect(p1).not.toBeNull();
    expect(p1?.inicio.toISOString().slice(0, 10)).toBe('2025-12-31');
    expect(p1?.fim.toISOString().slice(0, 10)).toBe('2026-09-16');

    // 2. Nome de arquivo no padrão YYYY-MM_a_YYYY-MM
    const p2 = conciliacaoService.extrairPeriodoDocumento(
      null,
      'IA_LOTE_Extrato_Neon_2025-12_a_2026-09.pdf'
    );
    expect(p2).not.toBeNull();
    expect(p2?.inicio.toISOString().slice(0, 10)).toBe('2025-12-01');
    expect(p2?.fim.toISOString().slice(0, 10)).toBe('2026-09-30');
  });

  it('não deve gerar alertas de lacuna para meses sem movimentação quando o período do extrato cobre o intervalo', async () => {
    // Conta bancária Neon
    const contaNeon = await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Neon Teste Intervalo',
        tipo: 'CONTA_CORRENTE',
        ativo: true,
        monitorarConciliacao: true,
      },
    });

    // Simula lote e arquivo com extrato cobrindo 2025-12 a 2026-09
    const lote = await prisma.loteImportacao.create({
      data: { usuarioId, caminhoDiretorio: 'test-neon-intervalo' },
    });
    const arq = await prisma.arquivoImportacao.create({
      data: {
        loteId: lote.id,
        nomeArquivo: 'Extrato_Neon_2025-12_a_2026-09.pdf',
        caminhoRelativo: 'Extrato_Neon_2025-12_a_2026-09.pdf',
        status: 'PROCESSADO_FINAL',
      },
    });

    // Lançamentos apenas em 2026-05 e 2026-07 (sem lançamentos em 2026-06 nem 2026-08)
    await prisma.stagingLancamentoImportacao.create({
      data: {
        loteId: lote.id,
        arquivoId: arq.id,
        arquivoOrigem: arq.nomeArquivo,
        dataMovimento: new Date('2026-05-27T13:14:00Z'),
        descricao: 'PIX recebido',
        valor: 10000,
        natureza: 'RECEITA',
        statusProcessamento: 'PROCESSADO',
      },
    });
    await prisma.stagingLancamentoImportacao.create({
      data: {
        loteId: lote.id,
        arquivoId: arq.id,
        arquivoOrigem: arq.nomeArquivo,
        dataMovimento: new Date('2026-07-21T12:13:00Z'),
        descricao: 'PIX recebido',
        valor: 10000,
        natureza: 'RECEITA',
        statusProcessamento: 'PROCESSADO',
      },
    });

    // Cataloga arquivo (extrai o período de 2025-12 a 2026-09)
    await conciliacaoService.catalogarArquivo({
      usuarioId,
      arquivoId: arq.id,
      loteId: lote.id,
      contaId: contaNeon.id,
    });

    // Verifica lacunas
    const alertas = await conciliacaoService.verificarLacunas(usuarioId);

    // Não deve existir nenhum alerta de lacuna para 2026-06 ou 2026-08 na conta Neon
    const alertasNeon = alertas.filter((a: any) => a.contaId === contaNeon.id);
    expect(alertasNeon.length).toBe(0);
  });

  it('deve consultar detalhes, resumo consolidado e lançamentos de um arquivo importado com isolamento multi-tenant', async () => {
    const lote = await prisma.loteImportacao.create({
      data: {
        usuarioId,
        caminhoDiretorio: 'test-lancamentos-arquivo',
      },
    });

    const arquivo = await prisma.arquivoImportacao.create({
      data: {
        loteId: lote.id,
        nomeArquivo: 'extrato_detalhado.csv',
        caminhoRelativo: 'extrato_detalhado.csv',
        status: 'PROCESSADO_FINAL',
        statusFinal: 'SUCESSO',
        tamanhoBytes: 2048,
      },
    });

    // Cria movimento oficial vinculado pela origemDocumento
    await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: contaCartaoId,
        dataMovimento: new Date('2026-01-10T12:00:00Z'),
        competencia: '2026-01',
        descricao: 'Compra Mercado Teste',
        valor: 250.5,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        origemDocumento: `IA_LOTE_${arquivo.nomeArquivo}`,
      },
    });

    // Cria staging item vinculado
    await prisma.stagingLancamentoImportacao.create({
      data: {
        loteId: lote.id,
        arquivoId: arquivo.id,
        arquivoOrigem: arquivo.nomeArquivo,
        dataMovimento: new Date('2026-01-10T12:00:00Z'),
        descricao: 'Compra Mercado Teste',
        valor: 250.5,
        natureza: 'DESPESA',
        statusProcessamento: 'PROCESSADO',
      },
    });

    // Consulta com usuário proprietário
    const resultado = await conciliacaoService.obterLancamentosArquivo(arquivo.id, usuarioId);

    expect(resultado).toBeDefined();
    expect(resultado.arquivo.id).toBe(arquivo.id);
    expect(resultado.arquivo.nomeArquivo).toBe('extrato_detalhado.csv');
    expect(resultado.resumo.totalMovimentosOficiais).toBe(1);
    expect(resultado.resumo.totalStagingItens).toBe(1);
    expect(resultado.resumo.valorTotalMovimentos).toBe(250.5);
    expect(resultado.movimentos).toHaveLength(1);
    expect(resultado.movimentos[0].descricao).toBe('Compra Mercado Teste');
    expect(resultado.stagingItens).toHaveLength(1);

    // Tentativa de acesso por outro usuário deve falhar (isolamento multi-tenant)
    const outroUsuario = await prisma.usuario.create({
      data: {
        nome: 'Outro Usuario',
        email: `outro_${Date.now()}@evolvi.app`,
        senhaHash: 'hash',
      },
    });

    await expect(
      conciliacaoService.obterLancamentosArquivo(arquivo.id, outroUsuario.id)
    ).rejects.toThrow('Arquivo de importação não encontrado ou acesso não autorizado');
  });
});

