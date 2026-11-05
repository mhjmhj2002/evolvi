import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recorrenciaSincronizacaoService } from './recorrencia-sincronizacao.service.js';
import { recorrenciaSincronizacaoWorkerService } from './recorrencia-sincronizacao-worker.service.js';
import { authEventBus } from '../../infrastructure/events/auth-event-bus.js';

describe('Worker e Regras de Detecção de Gastos Recorrentes', () => {
  const usuarioTesteId = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d';
  let contaId: string;

  beforeEach(async () => {
    // Limpeza de dados do usuário de teste
    await prisma.recorrencia.deleteMany({ where: { usuarioId: usuarioTesteId } });
    await prisma.movimento.deleteMany({ where: { usuarioId: usuarioTesteId } });
    await prisma.conta.deleteMany({ where: { usuarioId: usuarioTesteId } });
    await prisma.usuario.deleteMany({ where: { id: usuarioTesteId } });

    // Criar usuário de teste
    await prisma.usuario.create({
      data: {
        id: usuarioTesteId,
        nome: 'Usuario Teste Recorrencia',
        email: `teste_rec_${Date.now()}@evolvi.app`,
        senhaHash: 'hash123',
      },
    });

    // Criar conta corrente para os movimentos
    const conta = await prisma.conta.create({
      data: {
        usuarioId: usuarioTesteId,
        nome: 'Conta Teste',
        tipo: 'CONTA_CORRENTE',
        saldoInicial: 0,
      },
    });
    contaId = conta.id;
  });

  it('1. Não deve considerar recorrente apenas 1 ocorrência isolada, exigindo pelo menos 2 meses seguidos', async () => {
    const dataMov = new Date('2026-10-13T12:00:00Z');

    // Inserir apenas 1 boleto de condomínio
    await prisma.movimento.create({
      data: {
        usuarioId: usuarioTesteId,
        contaId,
        descricao: 'PAG BOLETO CONDOMINIO DO EDIFICIO ALTAIR',
        valor: 698.74,
        natureza: 'DESPESA',
        competencia: '2026-10',
        dataMovimento: dataMov,
      },
    });

    // Com apenas 1 mês, a automação NÃO deve criar recorrência
    const resultado1 = await recorrenciaSincronizacaoService.sincronizarParaUsuario(usuarioTesteId, '2026-10');
    expect(resultado1.totalCriados).toBe(0);

    const recorrenciasApos1 = await prisma.recorrencia.findMany({ where: { usuarioId: usuarioTesteId } });
    expect(recorrenciasApos1).toHaveLength(0);

    // Inserir o segundo mês consecutivo (2026-09)
    await prisma.movimento.create({
      data: {
        usuarioId: usuarioTesteId,
        contaId,
        descricao: 'PAG BOLETO CONDOMINIO DO EDIFICIO ALTAIR',
        valor: 660.16,
        natureza: 'DESPESA',
        competencia: '2026-09',
        dataMovimento: new Date('2026-09-13T12:00:00Z'),
      },
    });

    // Agora com 2 meses seguidos (09 e 10), deve promover para recorrente
    const resultado2 = await recorrenciaSincronizacaoService.sincronizarParaUsuario(usuarioTesteId, '2026-10');
    expect(resultado2.totalCriados).toBe(1);

    const recorrenciasApos2 = await prisma.recorrencia.findMany({ where: { usuarioId: usuarioTesteId } });
    expect(recorrenciasApos2).toHaveLength(1);
    expect(recorrenciasApos2[0].descricao).toBe('Condomínio Edifício Altair');
    expect(Number(recorrenciasApos2[0].valorReferencia)).toBe(679.45); // Média de 698.74 e 660.16
    expect(recorrenciasApos2[0].diaPrevisto).toBe(13);
    expect(recorrenciasApos2[0].essencial).toBe(true);
    expect(recorrenciasApos2[0].formaPagamento).toBe('Boleto');
  });

  it('2. Deve detectar despesa recorrente por repetição em múltiplos meses (>= 2 competências distintas)', async () => {
    // Inserir gasto em meses distintos sem palavra-chave clássica
    await prisma.movimento.createMany({
      data: [
        {
          usuarioId: usuarioTesteId,
          contaId,
          descricao: 'Servico de Jardinagem do Quintal',
          valor: 150.0,
          natureza: 'DESPESA',
          competencia: '2026-08',
          dataMovimento: new Date('2026-08-10T12:00:00Z'),
        },
        {
          usuarioId: usuarioTesteId,
          contaId,
          descricao: 'Servico de Jardinagem do Quintal',
          valor: 170.0,
          natureza: 'DESPESA',
          competencia: '2026-09',
          dataMovimento: new Date('2026-09-10T12:00:00Z'),
        },
      ],
    });

    const resultado = await recorrenciaSincronizacaoService.sincronizarParaUsuario(usuarioTesteId, '2026-10');
    expect(resultado.totalCriados).toBe(1);

    const rec = await prisma.recorrencia.findFirst({
      where: { usuarioId: usuarioTesteId, descricao: { contains: 'Jardinagem' } },
    });
    expect(rec).not.toBeNull();
    // Média de 150 e 170 = 160
    expect(Number(rec?.valorReferencia)).toBe(160.0);
    expect(rec?.status).toBe('ATIVA');
  });

  it('3. Não deve duplicar compromissos já cadastrados pelo usuário (idempotência)', async () => {
    // Usuário já cadastrou manualmente o condomínio com R$ 700 e dia 10
    await prisma.recorrencia.create({
      data: {
        usuarioId: usuarioTesteId,
        descricao: 'Condomínio Edifício Altair',
        valorReferencia: 700.0,
        diaPrevisto: 10,
        status: 'ATIVA',
      },
    });

    // Inserir movimento do condomínio
    await prisma.movimento.create({
      data: {
        usuarioId: usuarioTesteId,
        contaId,
        descricao: 'PAG BOLETO CONDOMINIO DO EDIFICIO ALTAIR',
        valor: 698.74,
        natureza: 'DESPESA',
        competencia: '2026-10',
        dataMovimento: new Date('2026-10-13T12:00:00Z'),
      },
    });

    const resultado = await recorrenciaSincronizacaoService.sincronizarParaUsuario(usuarioTesteId, '2026-10');
    expect(resultado.totalCriados).toBe(0); // Não duplica!

    const todas = await prisma.recorrencia.findMany({ where: { usuarioId: usuarioTesteId } });
    expect(todas).toHaveLength(1);
    expect(Number(todas[0].valorReferencia)).toBe(700.0); // Preserva a decisão do usuário
  });

  it('4. Deve executar nos gatilhos de eventos do Worker (Login e Importação)', async () => {
    recorrenciaSincronizacaoWorkerService.setupEventListener();

    // Inserir movimento de energia elétrica em 2 meses consecutivos (2026-09 e 2026-10)
    await prisma.movimento.createMany({
      data: [
        {
          usuarioId: usuarioTesteId,
          contaId,
          descricao: 'DA EDP ES 190023203',
          valor: 340.0,
          natureza: 'DESPESA',
          competencia: '2026-09',
          dataMovimento: new Date('2026-09-25T12:00:00Z'),
        },
        {
          usuarioId: usuarioTesteId,
          contaId,
          descricao: 'DA EDP ES 190023203',
          valor: 350.0,
          natureza: 'DESPESA',
          competencia: '2026-10',
          dataMovimento: new Date('2026-10-25T12:00:00Z'),
        },
      ],
    });

    // Disparar evento de autenticação
    authEventBus.emitUsuarioAutenticado({
      usuarioId: usuarioTesteId,
      email: 'teste@evolvi.app',
      timestamp: new Date(),
    });

    // Aguardar execução assíncrona do worker
    await new Promise((resolve) => setTimeout(resolve, 800));

    const recs = await prisma.recorrencia.findMany({ where: { usuarioId: usuarioTesteId } });
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs.some((r) => r.descricao.includes('EDP'))).toBe(true);

    recorrenciaSincronizacaoWorkerService.removeEventListener();
  });

  it('5. NÃO deve considerar compras na feira (mais de um lançamento por mês)', async () => {
    // Simula compras semanais na feira em meses consecutivos
    await prisma.movimento.createMany({
      data: [
        {
          usuarioId: usuarioTesteId,
          contaId,
          descricao: 'Feira Livre Praia da Costa',
          valor: 85.0,
          natureza: 'DESPESA',
          competencia: '2026-09',
          dataMovimento: new Date('2026-09-05T12:00:00Z'),
        },
        {
          usuarioId: usuarioTesteId,
          contaId,
          descricao: 'Feira Livre Praia da Costa',
          valor: 92.0,
          natureza: 'DESPESA',
          competencia: '2026-09',
          dataMovimento: new Date('2026-09-12T12:00:00Z'),
        },
        {
          usuarioId: usuarioTesteId,
          contaId,
          descricao: 'Feira Livre Praia da Costa',
          valor: 88.0,
          natureza: 'DESPESA',
          competencia: '2026-10',
          dataMovimento: new Date('2026-10-03T12:00:00Z'),
        },
        {
          usuarioId: usuarioTesteId,
          contaId,
          descricao: 'Feira Livre Praia da Costa',
          valor: 95.0,
          natureza: 'DESPESA',
          competencia: '2026-10',
          dataMovimento: new Date('2026-10-10T12:00:00Z'),
        },
      ],
    });

    const resultado = await recorrenciaSincronizacaoService.sincronizarParaUsuario(usuarioTesteId, '2026-10');
    expect(resultado.totalCriados).toBe(0);

    const recs = await prisma.recorrencia.findMany({ where: { usuarioId: usuarioTesteId } });
    expect(recs).toHaveLength(0);
  });

  it('6. NÃO deve considerar compras com valores muito discrepantes entre os meses', async () => {
    await prisma.movimento.createMany({
      data: [
        {
          usuarioId: usuarioTesteId,
          contaId,
          descricao: 'Loja de Utilidades Centro',
          valor: 45.0,
          natureza: 'DESPESA',
          competencia: '2026-09',
          dataMovimento: new Date('2026-09-15T12:00:00Z'),
        },
        {
          usuarioId: usuarioTesteId,
          contaId,
          descricao: 'Loja de Utilidades Centro',
          valor: 180.0, // Variação de 300%
          natureza: 'DESPESA',
          competencia: '2026-10',
          dataMovimento: new Date('2026-10-15T12:00:00Z'),
        },
      ],
    });

    const resultado = await recorrenciaSincronizacaoService.sincronizarParaUsuario(usuarioTesteId, '2026-10');
    expect(resultado.totalCriados).toBe(0);

    const recs = await prisma.recorrencia.findMany({ where: { usuarioId: usuarioTesteId } });
    expect(recs).toHaveLength(0);
  });

  it('7. NÃO deve considerar compras com dias do mês muito distantes (> 6 dias de diferença)', async () => {
    await prisma.movimento.createMany({
      data: [
        {
          usuarioId: usuarioTesteId,
          contaId,
          descricao: 'Restaurante Central',
          valor: 120.0,
          natureza: 'DESPESA',
          competencia: '2026-09',
          dataMovimento: new Date('2026-09-02T12:00:00Z'), // Dia 02
        },
        {
          usuarioId: usuarioTesteId,
          contaId,
          descricao: 'Restaurante Central',
          valor: 125.0,
          natureza: 'DESPESA',
          competencia: '2026-10',
          dataMovimento: new Date('2026-10-24T12:00:00Z'), // Dia 24 (diferença de 22 dias)
        },
      ],
    });

    const resultado = await recorrenciaSincronizacaoService.sincronizarParaUsuario(usuarioTesteId, '2026-10');
    expect(resultado.totalCriados).toBe(0);

    const recs = await prisma.recorrencia.findMany({ where: { usuarioId: usuarioTesteId } });
    expect(recs).toHaveLength(0);
  });

  it('8. Deve remover/purgar recorrência automática pré-existente de padaria que viola as regras estritas', async () => {
    // 1. Simula recorrência automática prévia de padaria no banco
    await prisma.recorrencia.create({
      data: {
        usuarioId: usuarioTesteId,
        descricao: 'PadariaDiniz',
        valorReferencia: 61.89,
        diaPrevisto: 7,
        status: 'ATIVA',
      },
    });

    // 2. Movimentos no banco mostram múltiplas compras de padaria em um mesmo mês (compra recorrente diária/semanal)
    await prisma.movimento.createMany({
      data: [
        {
          usuarioId: usuarioTesteId,
          contaId,
          descricao: 'PadariaDiniz',
          valor: 8.5,
          natureza: 'DESPESA',
          competencia: '2026-09',
          dataMovimento: new Date('2026-09-02T12:00:00Z'),
        },
        {
          usuarioId: usuarioTesteId,
          contaId,
          descricao: 'PadariaDiniz',
          valor: 12.0,
          natureza: 'DESPESA',
          competencia: '2026-09',
          dataMovimento: new Date('2026-09-10T12:00:00Z'),
        },
        {
          usuarioId: usuarioTesteId,
          contaId,
          descricao: 'PadariaDiniz',
          valor: 15.0,
          natureza: 'DESPESA',
          competencia: '2026-10',
          dataMovimento: new Date('2026-10-05T12:00:00Z'),
        },
        {
          usuarioId: usuarioTesteId,
          contaId,
          descricao: 'PadariaDiniz',
          valor: 9.3,
          natureza: 'DESPESA',
          competencia: '2026-10',
          dataMovimento: new Date('2026-10-18T12:00:00Z'),
        },
      ],
    });

    // 3. Ao sincronizar, a recorrência inválida da Padaria deve ser purgada
    await recorrenciaSincronizacaoService.sincronizarParaUsuario(usuarioTesteId, '2026-10');

    const recs = await prisma.recorrencia.findMany({
      where: { usuarioId: usuarioTesteId, descricao: { contains: 'Padaria', mode: 'insensitive' } },
    });
    expect(recs).toHaveLength(0);
  });

  it('9. Não deve recriar nem reativar gastos recorrentes que o usuário cancelou/excluiu', async () => {
    // 1. Simula recorrência cancelada/excluída pelo usuário
    const recCancelada = await prisma.recorrencia.create({
      data: {
        usuarioId: usuarioTesteId,
        descricao: 'Seguro Residencial',
        valorReferencia: 85.0,
        diaPrevisto: 15,
        status: 'CANCELADA',
      },
    });

    // 2. Movimentos no banco continuam existindo nos meses anteriores
    await prisma.movimento.createMany({
      data: [
        {
          usuarioId: usuarioTesteId,
          contaId,
          descricao: 'Seguro Residencial Porto',
          valor: 85.0,
          natureza: 'DESPESA',
          competencia: '2026-09',
          dataMovimento: new Date('2026-09-15T12:00:00Z'),
        },
        {
          usuarioId: usuarioTesteId,
          contaId,
          descricao: 'Seguro Residencial Porto',
          valor: 85.0,
          natureza: 'DESPESA',
          competencia: '2026-10',
          dataMovimento: new Date('2026-10-15T12:00:00Z'),
        },
      ],
    });

    // 3. Ao sincronizar, o sincronizador deve respeitar a decisão e NÃO reativar nem duplicar
    const resultado = await recorrenciaSincronizacaoService.sincronizarParaUsuario(usuarioTesteId, '2026-10');
    expect(resultado.totalCriados).toBe(0);

    const recsAtivas = await prisma.recorrencia.findMany({
      where: { usuarioId: usuarioTesteId, status: 'ATIVA' },
    });
    expect(recsAtivas).toHaveLength(0);

    const recPersistida = await prisma.recorrencia.findUnique({
      where: { id: recCancelada.id },
    });
    expect(recPersistida?.status).toBe('CANCELADA');
  });
});


