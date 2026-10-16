import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../../app.js';
import { prisma } from '../../../infrastructure/database/prisma.js';
import {
  MovimentoRecalculoService,
  VERSAO_REGRAS_MOVIMENTOS_ATUAL,
} from '../../movimento/movimento-recalculo.service.js';
import { movimentoRecalculoWorkerService } from '../../movimento/movimento-recalculo-worker.service.js';
import { ImportacaoConsolidacaoWorkerService } from './importacao-consolidacao-worker.service.js';

describe('BUG-09: Prevalência Universal de Proventos/Salário/PLR e Recálculo Automático por Versão no Login', () => {
  let app: FastifyInstance;
  let usuario1Id: string;
  let usuario1Token: string;
  let usuario1Email: string;

  let usuario2Id: string;
  let usuario2Token: string;
  let usuario2Email: string;

  let contaUsuario1Id: string;
  let contaUsuario2Id: string;

  let consolidacaoWorker: ImportacaoConsolidacaoWorkerService;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    consolidacaoWorker = new ImportacaoConsolidacaoWorkerService();
    movimentoRecalculoWorkerService.setupEventListener();

    // 1. Cria Usuário 1 (simulando caso do relato: titular com nome e proventos bancários)
    usuario1Email = `user1-bug09-${Date.now()}@teste.com`;
    const resCad1 = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Carlos Eduardo Oliveira Santos',
        email: usuario1Email,
        senha: 'SenhaForte123!',
      },
    });
    const bodyCad1 = JSON.parse(resCad1.body);
    usuario1Id = bodyCad1.usuario.id;
    usuario1Token = bodyCad1.token;

    const conta1 = await prisma.conta.create({
      data: {
        usuarioId: usuario1Id,
        nome: 'Conta Corrente Santander',
        tipo: 'CONTA_CORRENTE',
      },
    });
    contaUsuario1Id = conta1.id;

    // 2. Cria Usuário 2 (Multi-tenant para validar isolamento)
    usuario2Email = `user2-bug09-${Date.now()}@teste.com`;
    const resCad2 = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Mariana Silva Ferreira',
        email: usuario2Email,
        senha: 'OutraSenha456!',
      },
    });
    const bodyCad2 = JSON.parse(resCad2.body);
    usuario2Id = bodyCad2.usuario.id;
    usuario2Token = bodyCad2.token;

    const conta2 = await prisma.conta.create({
      data: {
        usuarioId: usuario2Id,
        nome: 'Conta Corrente Itaú',
        tipo: 'CONTA_CORRENTE',
      },
    });
    contaUsuario2Id = conta2.id;
  });

  afterAll(async () => {
    if (usuario1Id || usuario2Id) {
      await prisma.movimento.deleteMany({
        where: { usuarioId: { in: [usuario1Id, usuario2Id].filter(Boolean) } },
      });
      await prisma.stagingLancamentoImportacao.deleteMany({
        where: { lote: { usuarioId: { in: [usuario1Id, usuario2Id].filter(Boolean) } } },
      });
      await prisma.arquivoImportacao.deleteMany({
        where: { lote: { usuarioId: { in: [usuario1Id, usuario2Id].filter(Boolean) } } },
      });
      await prisma.loteImportacao.deleteMany({
        where: { usuarioId: { in: [usuario1Id, usuario2Id].filter(Boolean) } },
      });
      await prisma.conta.deleteMany({
        where: { usuarioId: { in: [usuario1Id, usuario2Id].filter(Boolean) } },
      });
      await prisma.usuario.deleteMany({
        where: { id: { in: [usuario1Id, usuario2Id].filter(Boolean) } },
      });
    }
    await app.close();
  });

  it('1. Consolidador: deve consolidar TED CONTA SALARIO e PLR como RECEITA mesmo se vindo do staging como TRANSFERENCIA_PROPRIA ou contendo o nome do titular', async () => {
    // Cria lote para o Usuário 1
    const lote = await prisma.loteImportacao.create({
      data: {
        usuarioId: usuario1Id,
        status: 'PROCESSANDO_IA',
        caminhoDiretorio: '/tmp/test-bug09',
      },
    });

    const arquivo = await prisma.arquivoImportacao.create({
      data: {
        loteId: lote.id,
        nomeArquivo: 'Santander_Conta_2026-02.pdf',
        caminhoRelativo: 'Santander_Conta_2026-02.pdf',
        tamanhoBytes: 1024,
        mimeType: 'application/pdf',
        status: 'PROCESSADO_FINAL',
      },
    });

    // Insere os 4 lançamentos padrão de salário e PLR com o nome do titular
    await prisma.stagingLancamentoImportacao.createMany({
      data: [
        {
          loteId: lote.id,
          arquivoId: arquivo.id,
          arquivoOrigem: 'santander.pdf',
          dataMovimento: new Date('2026-02-13T00:00:00.000Z'),
          descricao: 'TED CONTA SALARIO - CARLOS EDUARDO OLIVEIRA SANTOS',
          valor: 5421.41,
          natureza: 'TRANSFERENCIA_PROPRIA', // Simula classificação equivocada da IA
          contaSugerida: 'Conta Corrente Santander',
          tipoConta: 'CONTA_CORRENTE',
          statusProcessamento: 'PENDENTE',
        },
        {
          loteId: lote.id,
          arquivoId: arquivo.id,
          arquivoOrigem: 'santander.pdf',
          dataMovimento: new Date('2026-02-13T00:00:00.000Z'),
          descricao: 'TED CONTA SALARIO - CARLOS EDUARDO OLIVEIRA SANTOS',
          valor: 4147.21,
          natureza: 'TRANSFERENCIA_PROPRIA',
          contaSugerida: 'Conta Corrente Santander',
          tipoConta: 'CONTA_CORRENTE',
          statusProcessamento: 'PENDENTE',
        },
        {
          loteId: lote.id,
          arquivoId: arquivo.id,
          arquivoOrigem: 'santander.pdf',
          dataMovimento: new Date('2026-02-26T00:00:00.000Z'),
          descricao: 'TED CONTA SALARIO - CARLOS EDUARDO OLIVEIRA SANTOS',
          valor: 3098.86,
          natureza: 'TRANSFERENCIA_PROPRIA',
          contaSugerida: 'Conta Corrente Santander',
          tipoConta: 'CONTA_CORRENTE',
          statusProcessamento: 'PENDENTE',
        },
        {
          loteId: lote.id,
          arquivoId: arquivo.id,
          arquivoOrigem: 'santander.pdf',
          dataMovimento: new Date('2026-02-27T00:00:00.000Z'),
          descricao: 'TED CONTA SALARIO - CARLOS EDUARDO OLIVEIRA SANTOS', // Crédito de PLR
          valor: 30859.22,
          natureza: 'TRANSFERENCIA_PROPRIA',
          contaSugerida: 'Conta Corrente Santander',
          tipoConta: 'CONTA_CORRENTE',
          statusProcessamento: 'PENDENTE',
        },
        {
          loteId: lote.id,
          arquivoId: arquivo.id,
          arquivoOrigem: 'santander.pdf',
          dataMovimento: new Date('2026-02-28T00:00:00.000Z'),
          descricao: 'PIX TRANSFERENCIA CARLOS EDUARDO OLIVEIRA SANTOS', // Transferência própria legítima
          valor: 1500.0,
          natureza: 'RECEITA',
          contaSugerida: 'Conta Corrente Santander',
          tipoConta: 'CONTA_CORRENTE',
          statusProcessamento: 'PENDENTE',
        },
      ],
    });

    const resConsolidacao = await consolidacaoWorker.consolidarLote(lote.id, usuario1Id);
    expect(resConsolidacao.sucesso).toBe(true);

    // Consulta os movimentos gerados
    const movsSalario = await prisma.movimento.findMany({
      where: {
        usuarioId: usuario1Id,
        descricao: { contains: 'TED CONTA SALARIO' },
      },
    });

    expect(movsSalario.length).toBe(4);
    // Todos os 4 devem ter sido forçados para RECEITA pela regra universal
    for (const mov of movsSalario) {
      expect(mov.natureza).toBe('RECEITA');
    }

    // A transferência própria genuína (sem padrão de salário/PLR) deve ser TRANSFERENCIA_PROPRIA
    const movPixProprio = await prisma.movimento.findFirst({
      where: {
        usuarioId: usuario1Id,
        descricao: { contains: 'PIX TRANSFERENCIA' },
      },
    });
    expect(movPixProprio).toBeDefined();
    expect(movPixProprio!.natureza).toBe('TRANSFERENCIA_PROPRIA');
  });

  it('2. MovimentoRecalculoService: deve reprocessar movimentos com versão anterior e isolar por usuário', async () => {
    // Insere no Usuário 1 movimentos congelados com TRANSFERENCIA_PROPRIA (simulando dados antigos)
    const movAntigoU1 = await prisma.movimento.create({
      data: {
        usuarioId: usuario1Id,
        contaId: contaUsuario1Id,
        dataMovimento: new Date('2026-02-15T00:00:00.000Z'),
        competencia: '2026-02',
        descricao: 'CRED SALARIO EMPRESA XYZ',
        valor: 8500.0,
        natureza: 'TRANSFERENCIA_PROPRIA', // Antiga classificação errada
        status: 'CONCILIADO',
      },
    });

    // Insere no Usuário 2 um movimento semelhante
    const movAntigoU2 = await prisma.movimento.create({
      data: {
        usuarioId: usuario2Id,
        contaId: contaUsuario2Id,
        dataMovimento: new Date('2026-02-15T00:00:00.000Z'),
        competencia: '2026-02',
        descricao: 'PAGAMENTO DE SALARIO REF 02/2026',
        valor: 9200.0,
        natureza: 'TRANSFERENCIA_PROPRIA',
        status: 'CONCILIADO',
      },
    });

    // Força Usuário 1 com versaoRegrasMovimentos = 1 (desatualizado)
    await prisma.usuario.update({
      where: { id: usuario1Id },
      data: { versaoRegrasMovimentos: 1 },
    });

    // Executa verificação e recálculo para Usuário 1
    const resRecalculo = await MovimentoRecalculoService.verificarERecalcularSeNecessario(usuario1Id);
    expect(resRecalculo.recalculado).toBe(true);
    expect(resRecalculo.versaoAnterior).toBe(1);
    expect(resRecalculo.versaoAplicada).toBe(VERSAO_REGRAS_MOVIMENTOS_ATUAL);
    expect(resRecalculo.totalConvertidosParaReceita).toBeGreaterThanOrEqual(1);

    // O movimento do Usuário 1 deve ter sido corrigido para RECEITA
    const movAtualizadoU1 = await prisma.movimento.findUnique({
      where: { id: movAntigoU1.id },
    });
    expect(movAtualizadoU1?.natureza).toBe('RECEITA');

    // O movimento do Usuário 2 NÃO deve ter sido tocado pelo recálculo do Usuário 1 (Isolamento Multi-tenant)
    const movInalteradoU2 = await prisma.movimento.findUnique({
      where: { id: movAntigoU2.id },
    });
    expect(movInalteradoU2?.natureza).toBe('TRANSFERENCIA_PROPRIA');

    // Se chamado novamente para o Usuário 1, não deve recalcular (idempotente)
    const resSegundaChamada = await MovimentoRecalculoService.verificarERecalcularSeNecessario(usuario1Id);
    expect(resSegundaChamada.recalculado).toBe(false);
  });

  it('3. Auth / Login: deve acionar o recálculo transparente no login e atualizar versaoRegrasMovimentos', async () => {
    // Configura Usuário 2 na versão 1
    await prisma.usuario.update({
      where: { id: usuario2Id },
      data: { versaoRegrasMovimentos: 1 },
    });

    // Login com Usuário 2
    const resLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: usuario2Email,
        senha: 'OutraSenha456!',
      },
    });

    expect(resLogin.statusCode).toBe(200);

    // Aguarda o worker em segundo plano concluir a atualização assíncrona
    let u2Atualizado = null;
    let movU2Corrigido = null;
    for (let i = 0; i < 20; i++) {
      u2Atualizado = await prisma.usuario.findUnique({
        where: { id: usuario2Id },
      });
      movU2Corrigido = await prisma.movimento.findFirst({
        where: {
          usuarioId: usuario2Id,
          descricao: { contains: 'PAGAMENTO DE SALARIO' },
        },
      });

      if (
        u2Atualizado?.versaoRegrasMovimentos === VERSAO_REGRAS_MOVIMENTOS_ATUAL &&
        movU2Corrigido?.natureza === 'RECEITA'
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Verifica que a versão do Usuário 2 foi promovida para a versão atual pelo worker
    expect(u2Atualizado?.versaoRegrasMovimentos).toBe(VERSAO_REGRAS_MOVIMENTOS_ATUAL);

    // E o movimento do Usuário 2 que estava pendente agora foi convertido para RECEITA
    expect(movU2Corrigido?.natureza).toBe('RECEITA');
  });

  afterAll(async () => {
    movimentoRecalculoWorkerService.removeEventListener();
  });
});
