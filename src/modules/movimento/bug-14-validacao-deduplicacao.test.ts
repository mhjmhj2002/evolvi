import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../infrastructure/database/prisma.js';
import {
  ValidacaoDeduplicacaoService,
  saoDuplicatasSemanticas,
  saoMesmaInstituicaoOuEquivalente,
} from './validacao-deduplicacao.service.js';
import { validacaoDeduplicacaoWorkerService } from './validacao-deduplicacao-worker.service.js';
import { movimentoRecalculoWorkerService } from './movimento-recalculo-worker.service.js';
import { authEventBus } from '../../infrastructure/events/auth-event-bus.js';
import { importacaoEventBus } from '../../infrastructure/events/importacao-event-bus.js';

describe('BUG-14: Motor de Validação em Malha Fina e Deduplicação Inteligente', () => {
  let usuarioId: string;
  let outroUsuarioId: string;
  let contaSantanderId: string;
  let contaOutroId: string;

  beforeAll(async () => {
    // 1. Criar usuário de teste principal
    const usuario = await prisma.usuario.create({
      data: {
        nome: 'Usuario Bug 14 Test',
        email: `test-bug-14-${Date.now()}@evolvi.app`,
        senhaHash: 'hash123',
      },
    });
    usuarioId = usuario.id;

    // 2. Outro usuário para garantir isolamento multi-tenant
    const outroUsuario = await prisma.usuario.create({
      data: {
        nome: 'Outro Usuario MultiTenant',
        email: `outro-bug-14-${Date.now()}@evolvi.app`,
        senhaHash: 'hash123',
      },
    });
    outroUsuarioId = outroUsuario.id;

    // 3. Contas bancárias
    const contaSantander = await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Santander',
        tipo: 'CONTA_CORRENTE',
      },
    });
    contaSantanderId = contaSantander.id;

    const contaOutro = await prisma.conta.create({
      data: {
        usuarioId: outroUsuarioId,
        nome: 'Santander',
        tipo: 'CONTA_CORRENTE',
      },
    });
    contaOutroId = contaOutro.id;
  });

  afterAll(async () => {
    // Limpeza multi-tenant
    await prisma.movimento.deleteMany({
      where: { usuarioId: { in: [usuarioId, outroUsuarioId] } },
    });
    await prisma.conta.deleteMany({
      where: { usuarioId: { in: [usuarioId, outroUsuarioId] } },
    });
    await prisma.usuario.deleteMany({
      where: { id: { in: [usuarioId, outroUsuarioId] } },
    });
    validacaoDeduplicacaoWorkerService.removeEventListener();
  });

  it('deve unificar lançamentos com variações de hífen no mesmo valor, data e instituição (Caso Hudson Desteffan)', async () => {
    const dataMov = new Date('2026-08-18T00:00:00.000Z');

    // Cria os dois lançamentos equivalentes com validadoDedupe = 'N'
    const movA = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: contaSantanderId,
        dataMovimento: dataMov,
        competencia: '2026-08',
        descricao: 'PIX ENVIADO 24213012 Hudson Desteffan',
        valor: 350.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        chaveDedupe: `hash-hudson-1-${Date.now()}`,
        origemDocumento: 'IA_LOTE_ComprovanteSantander-1789577834006.pdf',
        validadoDedupe: 'N',
      },
    });

    const movB = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: contaSantanderId,
        dataMovimento: dataMov,
        competencia: '2026-08',
        descricao: 'PIX ENVIADO - 24213012 Hudson Desteffan',
        valor: 350.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        chaveDedupe: `hash-hudson-2-${Date.now()}`,
        origemDocumento: 'IA_LOTE_Santander_Conta_2026-08_REPETECO.pdf',
        observacao: 'PIX enviado para terceiro',
        validadoDedupe: 'N',
      },
    });

    // Executa a malha fina
    const resultado = await ValidacaoDeduplicacaoService.executarMalhaFinaParaUsuario(usuarioId);

    expect(resultado.totalDuplicatasExcluidas).toBe(1);

    // Consulta os movimentos restantes de R$ 350 para este usuário
    const restantes = await prisma.movimento.findMany({
      where: {
        usuarioId,
        dataMovimento: dataMov,
        valor: 350.0,
      },
    });

    expect(restantes.length).toBe(1);
    expect(restantes[0].validadoDedupe).toBe('S');
    // Deve ter preservado o registro com observação preenchida
    expect(restantes[0].id).toBe(movB.id);
  });

  it('deve preservar compras reais e distintas no mesmo dia e mesmo valor (ex: BARRACA DO JULIO e BARRACA DO JULIO I)', async () => {
    const dataMov = new Date('2026-08-15T00:00:00.000Z');

    const movJulio = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: contaSantanderId,
        dataMovimento: dataMov,
        competencia: '2026-08',
        descricao: 'Compra no débito - BARRACA DO JULIO',
        valor: 10.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        chaveDedupe: `hash-julio-1-${Date.now()}`,
        origemDocumento: 'IA_LOTE_extrato.pdf',
        validadoDedupe: 'N',
      },
    });

    const movJulio1 = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: contaSantanderId,
        dataMovimento: dataMov,
        competencia: '2026-08',
        descricao: 'Compra no débito - BARRACA DO JULIO I',
        valor: 10.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        chaveDedupe: `hash-julio-2-${Date.now()}`,
        origemDocumento: 'IA_LOTE_extrato.pdf',
        validadoDedupe: 'N',
      },
    });

    // Garante que o comparador semântico entende a distinção
    expect(saoDuplicatasSemanticas(movJulio, movJulio1)).toBe(false);

    // Executa a malha fina
    const resultado = await ValidacaoDeduplicacaoService.executarMalhaFinaParaUsuario(usuarioId);

    // Não deve excluir nenhum dos dois
    const restantes = await prisma.movimento.findMany({
      where: {
        usuarioId,
        dataMovimento: dataMov,
        valor: 10.0,
      },
    });

    expect(restantes.length).toBe(2);
    expect(restantes.every((m) => m.validadoDedupe === 'S')).toBe(true);
  });

  it('não deve reprocessar registros que já possuem validadoDedupe = "S"', async () => {
    const dataMov = new Date('2026-07-10T00:00:00.000Z');

    await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: contaSantanderId,
        dataMovimento: dataMov,
        competencia: '2026-07',
        descricao: 'Compra Validada Previamente',
        valor: 75.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        chaveDedupe: `hash-val-prev-${Date.now()}`,
        validadoDedupe: 'S',
      },
    });

    const resultado = await ValidacaoDeduplicacaoService.executarMalhaFinaParaUsuario(usuarioId);
    expect(resultado.totalAvaliados).toBe(0);
    expect(resultado.totalDuplicatasExcluidas).toBe(0);
  });

  it('deve garantir isolamento multi-tenant: lançamentos idênticos em usuários diferentes não são excluídos', async () => {
    const dataMov = new Date('2026-06-01T00:00:00.000Z');

    const movUser1 = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: contaSantanderId,
        dataMovimento: dataMov,
        competencia: '2026-06',
        descricao: 'PIX ENVIADO 12345 Fornecedor',
        valor: 200.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        chaveDedupe: `hash-multi-1-${Date.now()}`,
        validadoDedupe: 'N',
      },
    });

    const movUser2 = await prisma.movimento.create({
      data: {
        usuarioId: outroUsuarioId,
        contaId: contaOutroId,
        dataMovimento: dataMov,
        competencia: '2026-06',
        descricao: 'PIX ENVIADO 12345 Fornecedor',
        valor: 200.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        chaveDedupe: `hash-multi-2-${Date.now()}`,
        validadoDedupe: 'N',
      },
    });

    // Roda malha fina apenas para usuarioId
    const resUser1 = await ValidacaoDeduplicacaoService.executarMalhaFinaParaUsuario(usuarioId);
    expect(resUser1.totalDuplicatasExcluidas).toBe(0);

    // Verifica que o movimento de outroUsuarioId continua intacto e isolado
    const checkUser2 = await prisma.movimento.findUnique({
      where: { id: movUser2.id },
    });
    expect(checkUser2).not.toBeNull();
    expect(checkUser2?.validadoDedupe).toBe('N');
  });

  it('deve ser acionado automaticamente via eventos do sistema (Login e Conclusão de Lote)', async () => {
    movimentoRecalculoWorkerService.setupEventListener();
    validacaoDeduplicacaoWorkerService.setupEventListener();

    const userEvent = await prisma.usuario.create({
      data: {
        nome: 'Usuario Evento Login',
        email: `test-event-login-${Date.now()}@evolvi.app`,
        senhaHash: 'hash123',
        versaoRegrasMovimentos: 1,
      },
    });

    const contaEvent = await prisma.conta.create({
      data: {
        usuarioId: userEvent.id,
        nome: 'Santander',
        tipo: 'CONTA_CORRENTE',
      },
    });

    const dataMov = new Date('2026-05-05T00:00:00.000Z');

    const mov1 = await prisma.movimento.create({
      data: {
        usuarioId: userEvent.id,
        contaId: contaEvent.id,
        dataMovimento: dataMov,
        competencia: '2026-05',
        descricao: 'Pagamento Servico - Internet Fibra',
        valor: 119.9,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        chaveDedupe: `hash-worker-1-${Date.now()}`,
        validadoDedupe: 'N',
      },
    });

    const mov2 = await prisma.movimento.create({
      data: {
        usuarioId: userEvent.id,
        contaId: contaEvent.id,
        dataMovimento: dataMov,
        competencia: '2026-05',
        descricao: 'Pagamento Servico Internet Fibra',
        valor: 119.9,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        chaveDedupe: `hash-worker-2-${Date.now()}`,
        validadoDedupe: 'N',
      },
    });

    // Emite evento de login para o usuário
    authEventBus.emitUsuarioAutenticado({
      usuarioId: userEvent.id,
      email: userEvent.email,
      timestamp: new Date(),
    });

    // Aguarda processamento assíncrono do worker
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const restantes = await prisma.movimento.findMany({
      where: {
        usuarioId: userEvent.id,
        dataMovimento: dataMov,
        valor: 119.9,
      },
    });

    expect(restantes.length).toBe(1);
    expect(restantes[0].validadoDedupe).toBe('S');
  });

  it('deve acionar os 3 fluxos (BUG-09 Salário/PLR, TASK-43 Inteligência Combinatória e BUG-14 Deduplicação) ao finalizar importação com IA', async () => {
    movimentoRecalculoWorkerService.setupEventListener();
    validacaoDeduplicacaoWorkerService.setupEventListener();

    const userLote = await prisma.usuario.create({
      data: {
        nome: 'Usuario Evento Lote',
        email: `test-event-lote-${Date.now()}@evolvi.app`,
        senhaHash: 'hash123',
        versaoRegrasMovimentos: 1,
      },
    });

    const contaLote = await prisma.conta.create({
      data: {
        usuarioId: userLote.id,
        nome: 'Santander',
        tipo: 'CONTA_CORRENTE',
      },
    });

    const dataMov = new Date('2026-05-10T12:00:00.000Z');

    // 1. Movimento de salário classificado erroneamente como TRANSFERENCIA_PROPRIA (fluxo 1: BUG-09)
    const movSalario = await prisma.movimento.create({
      data: {
        usuarioId: userLote.id,
        contaId: contaLote.id,
        dataMovimento: dataMov,
        competencia: '2026-05',
        descricao: 'CRED TED SALARIO EMPRESA XYZ',
        valor: 5000.0,
        natureza: 'TRANSFERENCIA_PROPRIA', // Chegou do extrato/IA como transferência própria indevida
        status: 'CONCILIADO',
        chaveDedupe: `hash-salario-${Date.now()}`,
        validadoDedupe: 'N',
      },
    });

    // 2. Dois movimentos duplicados para testar fluxo 3: BUG-14 Deduplicação
    const movDuplicado1 = await prisma.movimento.create({
      data: {
        usuarioId: userLote.id,
        contaId: contaLote.id,
        dataMovimento: dataMov,
        competencia: '2026-05',
        descricao: 'POSTO IPIRANGA COMBUSTIVEL',
        valor: 200.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        chaveDedupe: `hash-dup-1-${Date.now()}`,
        validadoDedupe: 'N',
      },
    });

    const movDuplicado2 = await prisma.movimento.create({
      data: {
        usuarioId: userLote.id,
        contaId: contaLote.id,
        dataMovimento: dataMov,
        competencia: '2026-05',
        descricao: 'POSTO IPIRANGA COMBUSTIVEL',
        valor: 200.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        chaveDedupe: `hash-dup-2-${Date.now()}`,
        validadoDedupe: 'N',
      },
    });

    // Emite evento de lote concluído pela IA
    importacaoEventBus.emitLoteConcluido({
      loteId: 'lote-teste-ia-123',
      usuarioId: userLote.id,
      totalArquivos: 1,
      totalTransacoesImportadas: 3,
      totalDuplicadasIgnoradas: 0,
      totalContasCriadas: 0,
      timestamp: new Date(),
    });

    // Aguarda processamento assíncrono dos workers via event bus
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Verifica Fluxo 1: Salário convertido para RECEITA
    const salarioVerificado = await prisma.movimento.findUnique({
      where: { id: movSalario.id },
    });
    expect(salarioVerificado?.natureza).toBe('RECEITA');

    // Verifica Fluxo 3: Deduplicação efetuada
    const postosRestantes = await prisma.movimento.findMany({
      where: {
        usuarioId: userLote.id,
        dataMovimento: dataMov,
        valor: 200.0,
      },
    });
    expect(postosRestantes.length).toBe(1);
    expect(postosRestantes[0].validadoDedupe).toBe('S');
  });

  describe('BUG-15: Deduplicação com Inversão de Ordem dos Termos e Siglas Bancárias com Falso Sufixo Ordinal', () => {
    it('deve identificar como duplicatas semânticas termos invertidos e traços: "OPERACOES CREDITO IMOBILIARIO PREST CR IM" vs "PREST CR IM – OPERACOES CREDITO IMOBILIARIO"', () => {
      const mov1 = {
        descricao: 'OPERACOES CREDITO IMOBILIARIO PREST CR IM',
      };
      const mov2 = {
        descricao: 'PREST CR IM – OPERACOES CREDITO IMOBILIARIO',
      };
      const mov3 = {
        descricao: 'PREST CR IM - OPERACOES CREDITO IMOBILIARIO',
      };

      expect(saoDuplicatasSemanticas(mov1, mov2)).toBe(true);
      expect(saoDuplicatasSemanticas(mov1, mov3)).toBe(true);
      expect(saoDuplicatasSemanticas(mov2, mov3)).toBe(true);
    });

    it('não deve considerar siglas bancárias como ordinais romanos (ex: "IM", "TED", "DOC", "IOF")', () => {
      // "IM" não deve impedir a deduplicação
      const descComSiglaA = { descricao: 'PAGAMENTO OPERACOES CREDITO IMOBILIARIO PREST CR IM' };
      const descComSiglaB = { descricao: 'PAGAMENTO PREST CR IM OPERACOES CREDITO IMOBILIARIO' };
      expect(saoDuplicatasSemanticas(descComSiglaA, descComSiglaB)).toBe(true);

      // Por outro lado, ordinais reais distintos DEVEM impedir a deduplicação
      const movBarraca = { descricao: 'BARRACA DO JULIO' };
      const movBarracaI = { descricao: 'BARRACA DO JULIO I' };
      const movBarracaII = { descricao: 'BARRACA DO JULIO II' };
      const movBarraca1 = { descricao: 'BARRACA DO JULIO 1' };

      expect(saoDuplicatasSemanticas(movBarraca, movBarracaI)).toBe(false);
      expect(saoDuplicatasSemanticas(movBarracaI, movBarracaII)).toBe(false);
      expect(saoDuplicatasSemanticas(movBarraca, movBarraca1)).toBe(false);
    });

    it('deve unificar os lançamentos do financiamento imobiliário Santander de 10/08/2026 e suportar reprocessarTudo', async () => {
      const dataFinanc = new Date('2026-08-10T00:00:00.000Z');

      // Cria os dois lançamentos reais relatados no BUG-15
      const movFinanc1 = await prisma.movimento.create({
        data: {
          usuarioId,
          contaId: contaSantanderId,
          dataMovimento: dataFinanc,
          competencia: '2026-08',
          descricao: 'OPERACOES CREDITO IMOBILIARIO PREST CR IM',
          valor: 1393.73,
          natureza: 'DESPESA',
          status: 'CONCILIADO',
          chaveDedupe: `hash-financ-1-${Date.now()}`,
          origemDocumento: 'ComprovanteSantander-1789577834006.pdf',
          validadoDedupe: 'S', // Simula que anteriormente havia sido validado com 'S' erroneamente
        },
      });

      const movFinanc2 = await prisma.movimento.create({
        data: {
          usuarioId,
          contaId: contaSantanderId,
          dataMovimento: dataFinanc,
          competencia: '2026-08',
          descricao: 'PREST CR IM – OPERACOES CREDITO IMOBILIARIO',
          valor: 1393.73,
          natureza: 'DESPESA',
          status: 'CONCILIADO',
          chaveDedupe: `hash-financ-2-${Date.now()}`,
          origemDocumento: 'Santander_Conta_2026-08_REPETECO.pdf',
          observacao: 'Prestação de Financiamento Habitacional',
          validadoDedupe: 'S', // Também simulado como já validado
        },
      });

      // Executa malha fina com a nova opção de reprocessarTudo
      const resultado = await ValidacaoDeduplicacaoService.executarMalhaFinaParaUsuario(usuarioId, {
        reprocessarTudo: true,
      });

      expect(resultado.totalDuplicatasExcluidas).toBeGreaterThanOrEqual(1);

      // Confere que agora resta apenas 1 registro de R$ 1.393,73 em 10/08/2026
      const restantesFinanc = await prisma.movimento.findMany({
        where: {
          usuarioId,
          dataMovimento: dataFinanc,
          valor: 1393.73,
        },
      });

      expect(restantesFinanc.length).toBe(1);
      expect(restantesFinanc[0].validadoDedupe).toBe('S');
      // Deve ter preservado o registro mais rico (com observação preenchida)
      expect(restantesFinanc[0].id).toBe(movFinanc2.id);
    });
  });
});
