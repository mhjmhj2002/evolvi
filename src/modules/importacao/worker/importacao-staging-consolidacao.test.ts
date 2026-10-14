import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import { buildApp } from '../../../app.js';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { ImportacaoStorageService } from '../importacao-storage.service.js';
import { ImportacaoIaWorkerService } from './importacao-ia-worker.service.js';
import { ImportacaoStagingWorkerService } from './importacao-staging-worker.service.js';
import { ImportacaoConsolidacaoWorkerService } from './importacao-consolidacao-worker.service.js';
import {
  importacaoEventBus,
  ImportacaoEventBus,
  ImportacaoArquivoStagingCarregadoEvent,
  ImportacaoTransacaoConsolidadaEvent,
  ImportacaoLoteConcluidoEvent,
} from '../../../infrastructure/events/importacao-event-bus.js';
import { IIaExtratorClient } from './ia-extrator.client.js';

describe('TASK-34: Worker 2 de Carga em Staging e Worker 3 de Consolidação com Auto-Cadastro de Contas (IMP-WRK-STAGING-NEGOCIO)', () => {
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

    // 1. Cria Usuário 1
    const email1 = `user1-task34-${Date.now()}@evolvi.app`;
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario Staging Negocio',
        email: email1,
        senha: 'SenhaForte123!',
      },
    });
    const body1 = JSON.parse(res1.body);
    usuarioId = body1.usuario.id;
    token = body1.token;

    // Cria uma conta pré-existente para o Usuário 1 (ex: Nubank)
    await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Nubank Conta Corrente',
        tipo: 'CONTA_CORRENTE',
      },
    });

    // 2. Cria Usuário 2 para testes multi-tenant
    const email2 = `user2-task34-${Date.now()}@evolvi.app`;
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario Isolado',
        email: email2,
        senha: 'SenhaForte123!',
      },
    });
    const body2 = JSON.parse(res2.body);
    usuario2Id = body2.usuario.id;
    token2 = body2.token;
  });

  afterAll(async () => {
    // Limpeza de pastas físicas
    for (const pasta of pastasParaLimpeza) {
      try {
        await fs.rm(path.resolve(process.cwd(), pasta), { recursive: true, force: true });
      } catch {
        // ignora
      }
    }
  });

  it('1. Worker 2: Deve ler arquivo JSON consolidado físico e preencher a tabela staging_lancamentos_importacao', async () => {
    // Prepara um lote com arquivo recepcionado
    const lote = await storageService.recepcionarLote({
      usuarioId,
      arquivos: [
        {
          nomeOriginal: 'extrato_itau.ofx',
          buffer: Buffer.from('OFXHEADER:100...'),
          mimeType: 'application/x-ofx',
        },
      ],
    });
    pastasParaLimpeza.push(lote.caminhoDiretorio);
    const arquivo = lote.arquivos[0];

    // Simula a IA tendo gerado o consolidado físico
    const jsonConsolidado = {
      loteId: lote.loteId,
      arquivoId: arquivo.id,
      nomeArquivoOrigem: arquivo.nomeArquivo,
      totalTransacoes: 3,
      geradoEm: new Date().toISOString(),
      metadados: {
        provedor: 'GEMINI',
        modelo: 'gemini-2.5-flash',
        tentativas: 1,
      },
      transacoes: [
        {
          dataMovimento: '2026-09-10',
          descricao: 'Supermercado Pão de Açúcar',
          valor: 245.5,
          natureza: 'DESPESA',
          contaSugerida: 'Itaú Personalité',
          tipoConta: 'CONTA_CORRENTE',
          categoriaSugerida: 'Alimentação',
        },
        {
          dataMovimento: '2026-09-11',
          descricao: 'Salário Empresa S/A',
          valor: 9500.0,
          natureza: 'RECEITA',
          contaSugerida: 'Itaú Personalité',
          tipoConta: 'CONTA_CORRENTE',
          categoriaSugerida: 'Rendimento do trabalho',
        },
        {
          dataMovimento: '2026-09-12',
          descricao: 'Pagamento Fatura Cartão Santander',
          valor: 1800.0,
          natureza: 'DESPESA',
          contaSugerida: 'Itaú Personalité',
          tipoConta: 'CONTA_CORRENTE',
          categoriaSugerida: 'Outros',
        },
      ],
    };

    const caminhoConsolidado = path.resolve(
      process.cwd(),
      lote.caminhoDiretorio,
      `consolidado_${arquivo.id}.json`
    );
    await fs.writeFile(caminhoConsolidado, JSON.stringify(jsonConsolidado, null, 2), 'utf-8');

    // Atualiza status do arquivo para IA_CONCLUIDO
    await prisma.arquivoImportacao.update({
      where: { id: arquivo.id },
      data: { status: 'IA_CONCLUIDO' },
    });

    // Executa Worker 2
    const stagingWorker = new ImportacaoStagingWorkerService();
    const stagingEventPromise = new Promise<ImportacaoArquivoStagingCarregadoEvent>((resolve) => {
      importacaoEventBus.once(ImportacaoEventBus.EVENT_ARQUIVO_STAGING_CARREGADO, resolve);
    });

    const resCarga = await stagingWorker.carregarArquivoParaStaging(arquivo.id, usuarioId);
    if (!resCarga.sucesso) {
      console.error('ERRO DETALHADO CARGA:', resCarga.erro);
    }

    expect(resCarga.sucesso).toBe(true);
    expect(resCarga.totalLinhasCarregadas).toBe(3);

    // Valida evento emitido
    const eventStaging = await stagingEventPromise;
    expect(eventStaging.arquivoId).toBe(arquivo.id);
    expect(eventStaging.totalLinhasStaging).toBe(3);

    // Valida persistência na tabela de staging
    const linhasStaging = await prisma.stagingLancamentoImportacao.findMany({
      where: { arquivoId: arquivo.id },
      orderBy: { dataMovimento: 'asc' },
    });

    expect(linhasStaging).toHaveLength(3);
    expect(linhasStaging[0].descricao).toBe('Supermercado Pão de Açúcar');
    expect(Number(linhasStaging[0].valor)).toBe(245.5);
    expect(linhasStaging[0].contaSugerida).toBe('Itaú Personalité');
    expect(linhasStaging[0].tipoConta).toBe('CONTA_CORRENTE');
    expect(linhasStaging[0].statusProcessamento).toBe('PENDENTE');

    // Valida status do arquivo atualizado para STAGING_CARREGADO
    const arquivoAtualizado = await prisma.arquivoImportacao.findUnique({
      where: { id: arquivo.id },
    });
    expect(arquivoAtualizado?.status).toBe('STAGING_CARREGADO');
  });

  it('2. Worker 3: Deve auto-cadastrar conta inexistente ("Itaú Personalité") sem interromper o processo', async () => {
    // Verifica que a conta Itaú ainda NÃO existe para o usuário
    const contaAntes = await prisma.conta.findFirst({
      where: { usuarioId, nome: 'Itaú Personalité' },
    });
    expect(contaAntes).toBeNull();

    const consolidacaoWorker = new ImportacaoConsolidacaoWorkerService();
    const resConta = await consolidacaoWorker.obterOuAutoCadastrarConta({
      usuarioId,
      contaSugerida: 'Itaú Personalité',
      tipoConta: 'CONTA_CORRENTE',
    });

    expect(resConta.criadaAgora).toBe(true);
    expect(resConta.contaNome).toBe('Itaú Personalité');

    // Verifica que agora existe no banco
    const contaCriada = await prisma.conta.findUnique({
      where: { id: resConta.contaId },
    });
    expect(contaCriada).toBeDefined();
    expect(contaCriada?.usuarioId).toBe(usuarioId);
    expect(contaCriada?.tipo).toBe('CONTA_CORRENTE');

    // Chamada subsequente com o mesmo nome deve reusar sem criar duplicada
    const resContaReuso = await consolidacaoWorker.obterOuAutoCadastrarConta({
      usuarioId,
      contaSugerida: 'Itaú Personalité',
      tipoConta: 'CONTA_CORRENTE',
    });
    expect(resContaReuso.criadaAgora).toBe(false);
    expect(resContaReuso.contaId).toBe(resConta.contaId);
  });

  it('3. Worker 3: Deve aplicar anti-dupla contagem (fatura de cartão) e deduplicação determinística', async () => {
    // Cria um lote com arquivo e carga pré-realizada em staging
    const lote = await storageService.recepcionarLote({
      usuarioId,
      arquivos: [
        {
          nomeOriginal: 'fatura_e_extrato.csv',
          buffer: Buffer.from('data,desc,valor'),
          mimeType: 'text/csv',
        },
      ],
    });
    pastasParaLimpeza.push(lote.caminhoDiretorio);
    const arquivo = lote.arquivos[0];

    // Insere manualmente 2 itens na staging do lote:
    // 1. Pagamento de fatura (deve converter em TRANSFERENCIA_PROPRIA)
    // 2. Compra parcelada (deve criar movimento e parcelamento ativo)
    await prisma.stagingLancamentoImportacao.createMany({
      data: [
        {
          loteId: lote.loteId,
          arquivoId: arquivo.id,
          arquivoOrigem: arquivo.nomeArquivo,
          dataMovimento: new Date('2026-09-05T00:00:00.000Z'),
          descricao: 'Pagamento Fatura Cartão Inter',
          valor: 1500.0,
          natureza: 'DESPESA',
          contaSugerida: 'Nubank Conta Corrente',
          tipoConta: 'CONTA_CORRENTE',
          statusProcessamento: 'PENDENTE',
        },
        {
          loteId: lote.loteId,
          arquivoId: arquivo.id,
          arquivoOrigem: arquivo.nomeArquivo,
          dataMovimento: new Date('2026-09-08T00:00:00.000Z'),
          descricao: 'Notebook Dell Loja Online',
          valor: 600.0,
          natureza: 'DESPESA',
          contaSugerida: 'Cartão Inter Mastercard',
          tipoConta: 'CARTAO_CREDITO',
          categoriaSugerida: 'Habitação',
          parcelaAtual: 1,
          totalParcelas: 10,
          statusProcessamento: 'PENDENTE',
        },
      ],
    });

    const consolidacaoWorker = new ImportacaoConsolidacaoWorkerService();

    // Monitora emissão de eventos em tempo real
    const eventosConsolidados: ImportacaoTransacaoConsolidadaEvent[] = [];
    const eventHandler = (ev: ImportacaoTransacaoConsolidadaEvent) => {
      if (ev.loteId === lote.loteId) {
        eventosConsolidados.push(ev);
      }
    };
    importacaoEventBus.onTransacaoConsolidada(eventHandler);

    const resultado = await consolidacaoWorker.consolidarLote(lote.loteId, usuarioId);

    importacaoEventBus.removeListener(
      ImportacaoEventBus.EVENT_TRANSACAO_CONSOLIDADA,
      eventHandler
    );

    expect(resultado.sucesso).toBe(true);
    expect(resultado.totalProcessados).toBe(2);
    expect(resultado.novosMovimentosInseridos).toBe(2);
    expect(resultado.pagamentosFaturaConvertidos).toBe(1); // Fatura virou TRANSFERENCIA_PROPRIA
    expect(resultado.parcelamentosCriados).toBe(1); // Notebook 10x

    // Valida regra anti-dupla contagem no movimento persistido
    const movFatura = await prisma.movimento.findFirst({
      where: {
        usuarioId,
        descricao: 'Pagamento Fatura Cartão Inter',
      },
    });
    expect(movFatura).toBeDefined();
    expect(movFatura?.natureza).toBe('TRANSFERENCIA_PROPRIA');

    // Valida parcelamento persistido
    const parcelamento = await prisma.parcelamento.findFirst({
      where: {
        usuarioId,
        descricao: 'Notebook Dell Loja Online',
      },
    });
    expect(parcelamento).toBeDefined();
    expect(parcelamento?.totalParcelas).toBe(10);
    expect(Number(parcelamento?.valorTotal)).toBe(6000.0);
    expect(parcelamento?.status).toBe('ATIVO');

    // Valida eventos emitidos em tempo real com nome do arquivo
    expect(eventosConsolidados).toHaveLength(2);
    expect(eventosConsolidados[0].arquivoOrigem).toBe(arquivo.nomeArquivo);
    expect(eventosConsolidados[0].descricao).toBe('Pagamento Fatura Cartão Inter');

    // Valida status final de staging e arquivo
    const stagingsFinal = await prisma.stagingLancamentoImportacao.findMany({
      where: { loteId: lote.loteId },
    });
    expect(stagingsFinal.every((s) => s.statusProcessamento === 'PROCESSADO')).toBe(true);

    const arquivoFinal = await prisma.arquivoImportacao.findUnique({
      where: { id: arquivo.id },
    });
    expect(arquivoFinal?.status).toBe('PROCESSADO_FINAL');

    const loteFinal = await prisma.loteImportacao.findUnique({
      where: { id: lote.loteId },
    });
    expect(loteFinal?.status).toBe('CONCLUIDO');
  });

  it('4. Deduplicação: Reprocessar ou re-ingerir a mesma transação deve ignorar duplicata e marcar staging como IGNORADO', async () => {
    const lote = await storageService.recepcionarLote({
      usuarioId,
      arquivos: [
        {
          nomeOriginal: 'extrato_duplicado.csv',
          buffer: Buffer.from('data,desc,valor'),
          mimeType: 'text/csv',
        },
      ],
    });
    pastasParaLimpeza.push(lote.caminhoDiretorio);
    const arquivo = lote.arquivos[0];

    // Insere o mesmo movimento que já foi consolidado no teste anterior ("Notebook Dell Loja Online")
    await prisma.stagingLancamentoImportacao.create({
      data: {
        loteId: lote.loteId,
        arquivoId: arquivo.id,
        arquivoOrigem: arquivo.nomeArquivo,
        dataMovimento: new Date('2026-09-08T00:00:00.000Z'),
        descricao: 'Notebook Dell Loja Online',
        valor: 600.0,
        natureza: 'DESPESA',
        contaSugerida: 'Cartão Inter Mastercard',
        tipoConta: 'CARTAO_CREDITO',
        statusProcessamento: 'PENDENTE',
      },
    });

    const consolidacaoWorker = new ImportacaoConsolidacaoWorkerService();
    const resultado = await consolidacaoWorker.consolidarLote(lote.loteId, usuarioId);

    expect(resultado.totalProcessados).toBe(1);
    expect(resultado.novosMovimentosInseridos).toBe(0);
    expect(resultado.duplicadasIgnoradas).toBe(1);

    const staging = await prisma.stagingLancamentoImportacao.findFirst({
      where: { loteId: lote.loteId },
    });
    expect(staging?.statusProcessamento).toBe('IGNORADO');
  });

  it('5. Rotas REST e Isolamento Multi-Tenant: Usuário 2 não pode acessar ou acionar carga/consolidação de lote do Usuário 1', async () => {
    // Cria um lote para o Usuário 1
    const loteU1 = await storageService.recepcionarLote({
      usuarioId,
      arquivos: [
        {
          nomeOriginal: 'documento_privado.pdf',
          buffer: Buffer.from('PDF_DATA'),
          mimeType: 'application/pdf',
        },
      ],
    });
    pastasParaLimpeza.push(loteU1.caminhoDiretorio);

    // Usuário 2 tenta carregar staging do lote do Usuário 1
    const resStagingInvasao = await app.inject({
      method: 'POST',
      url: `/api/importacao/lotes/${loteU1.loteId}/carregar-staging`,
      headers: {
        authorization: `Bearer ${token2}`,
      },
    });
    expect(resStagingInvasao.statusCode).toBe(404);

    // Usuário 2 tenta consolidar o lote do Usuário 1
    const resConsolidarInvasao = await app.inject({
      method: 'POST',
      url: `/api/importacao/lotes/${loteU1.loteId}/consolidar`,
      headers: {
        authorization: `Bearer ${token2}`,
      },
    });
    expect(resConsolidarInvasao.statusCode).toBe(404);

    // Usuário 2 tenta consultar staging do lote do Usuário 1
    const resGetStagingInvasao = await app.inject({
      method: 'GET',
      url: `/api/importacao/lotes/${loteU1.loteId}/staging`,
      headers: {
        authorization: `Bearer ${token2}`,
      },
    });
    expect(resGetStagingInvasao.statusCode).toBe(404);

    // Usuário 1 acessa suas rotas com sucesso
    const resGetStagingU1 = await app.inject({
      method: 'GET',
      url: `/api/importacao/lotes/${loteU1.loteId}/staging`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    expect(resGetStagingU1.statusCode).toBe(200);
    const bodyStaging = JSON.parse(resGetStagingU1.body);
    expect(bodyStaging.loteId).toBe(loteU1.loteId);
  });
});
