import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../infrastructure/database/prisma.js';
import { buildApp } from '../../app.js';
import { motorExclusaoMediaService } from './motor-exclusao-media.service.js';
import { mediaMensalService } from './media-mensal.service.js';
import { mediaMensalWorkerService } from './media-mensal-worker.service.js';
import { authEventBus } from '../../infrastructure/events/auth-event-bus.js';
import { importacaoEventBus } from '../../infrastructure/events/importacao-event-bus.js';
import { baselineService } from '../fase1/baseline.service.js';
import { historicoConsumoService } from '../fase1/historico.service.js';

describe('Módulo de Média Mensal: Motor de Regras, Worker, CRUD de Exclusões e Tabela Consolidada', () => {
  let app: any;
  let usuarioId: string;
  let token: string;
  let contaId: string;
  let catAlimentacaoId: string;
  let catViagemId: string;

  beforeEach(async () => {
    app = await buildApp();

    // 1. Criar usuário de teste isolado
    const usuario = await prisma.usuario.create({
      data: {
        nome: 'Usuario Media Teste',
        email: `media_${Date.now()}_${Math.random().toString(36).substring(7)}@evolvi.app`,
        senhaHash: 'hash_senha_teste',
        rendaBaseMensal: 8000.0,
      },
    });
    usuarioId = usuario.id;

    token = app.jwt.sign({ sub: usuarioId, role: 'USER' });

    // 2. Criar conta para movimentos
    const conta = await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Conta Corrente Teste',
        tipo: 'CONTA_CORRENTE',
        saldoInicial: 1000.0,
      },
    });
    contaId = conta.id;

    // 3. Buscar ou criar categorias de teste
    let catAlim = await prisma.categoria.findFirst({
      where: { nome: { in: ['Alimentacao', 'Alimentação'] }, categoriaPaiId: null },
    });
    if (!catAlim) {
      catAlim = await prisma.categoria.create({
        data: { nome: 'Alimentacao', ordem: 1 },
      });
    }
    catAlimentacaoId = catAlim.id;

    let catViag = await prisma.categoria.findFirst({
      where: { nome: 'Viagem', categoriaPaiId: null },
    });
    if (!catViag) {
      catViag = await prisma.categoria.create({
        data: { nome: 'Viagem', ordem: 5 },
      });
    }
    catViagemId = catViag.id;
  });

  it('1. Motor de Regras: Deve identificar compra isolada de viagem (ocorrência única) e excluí-la automaticamente da média', async () => {
    // Inserir gastos de alimentação nos últimos meses (recorrentes)
    await prisma.movimento.createMany({
      data: [
        {
          usuarioId,
          contaId,
          categoriaId: catAlimentacaoId,
          dataMovimento: new Date('2026-05-10T12:00:00Z'),
          competencia: '2026-05',
          descricao: 'Supermercado Mensal Pão de Açúcar',
          valor: 1000.0,
          natureza: 'DESPESA',
          status: 'CONCILIADO',
        },
        {
          usuarioId,
          contaId,
          categoriaId: catAlimentacaoId,
          dataMovimento: new Date('2026-06-10T12:00:00Z'),
          competencia: '2026-06',
          descricao: 'Supermercado Mensal Pão de Açúcar',
          valor: 1000.0,
          natureza: 'DESPESA',
          status: 'CONCILIADO',
        },
        {
          usuarioId,
          contaId,
          categoriaId: catAlimentacaoId,
          dataMovimento: new Date('2026-07-10T12:00:00Z'),
          competencia: '2026-07',
          descricao: 'Supermercado Mensal Pão de Açúcar',
          valor: 1000.0,
          natureza: 'DESPESA',
          status: 'CONCILIADO',
        },
        // GASTO ÚNICO ESPORÁDICO DE VIAGEM (Viagem pro Chile)
        {
          usuarioId,
          contaId,
          categoriaId: catViagemId,
          dataMovimento: new Date('2026-07-20T12:00:00Z'),
          competencia: '2026-07',
          descricao: 'Passagem e Hospedagem Viagem pro Chile',
          valor: 6000.0,
          natureza: 'DESPESA',
          status: 'CONCILIADO',
        },
      ],
    });

    // Executa consolidação com janela de 6 meses (competência de referência: 2026-10)
    const consolidacao = await motorExclusaoMediaService.consolidarMedias(usuarioId, 6, '2026-10');

    expect(consolidacao.totalPeriodoBruto).toBe(9000.0);
    // Viagem pro Chile foi desconsiderada (R$ 6.000)
    expect(consolidacao.totalExcluido).toBe(6000.0);
    expect(consolidacao.totalPeriodoEfetivo).toBe(3000.0);
    // Média efetiva = R$ 3.000 / 6 meses = R$ 500/mês
    expect(consolidacao.mediaMensalEfetiva).toBe(500.0);
    expect(consolidacao.qtdLancamentosExcluidos).toBe(1);

    // Verificar na tabela consolidada
    const tabelaConsolidada = await prisma.mediaMensalConsolidada.findFirst({
      where: { usuarioId, categoriaId: null, competenciaReferencia: '2026-10' },
    });
    expect(tabelaConsolidada).not.toBeNull();
    expect(Number(tabelaConsolidada?.mediaMensalEfetiva)).toBe(500.0);
    expect(Number(tabelaConsolidada?.totalExcluido)).toBe(6000.0);

    // Verificar que o BaselineService também reflete a exclusão
    const baseline = await baselineService.calcularBaseline(usuarioId, '2026-10', 6);
    expect(baseline.media_mensal).toBe(500.0);
  });

  it('2. CRUD de Regras Personalizadas: Usuário cadastra regra de valor mínimo e termo e motor aplica', async () => {
    // Cadastrar regra para excluir gastos em "REFORMA APTO" acima de R$ 2000
    const regra = await mediaMensalService.criarRegra(usuarioId, {
      descricaoPadrao: 'REFORMA APTO',
      valorMinimo: 2000.0,
      apenasUmaVez: false,
      ativo: true,
      motivo: 'Gasto extraordinário de reforma',
    });
    expect(regra.id).toBeDefined();

    // Criar despesa correspondente
    await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        categoriaId: catAlimentacaoId,
        dataMovimento: new Date('2026-06-15T12:00:00Z'),
        competencia: '2026-06',
        descricao: 'Pagamento Reforma Apto Pintura',
        valor: 2500.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
      },
    });

    // Outra despesa normal
    await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        categoriaId: catAlimentacaoId,
        dataMovimento: new Date('2026-06-16T12:00:00Z'),
        competencia: '2026-06',
        descricao: 'Almoço Restaurante',
        valor: 150.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
      },
    });

    const consolidado = await motorExclusaoMediaService.consolidarMedias(usuarioId, 6, '2026-10');
    expect(consolidado.totalPeriodoBruto).toBe(2650.0);
    expect(consolidado.totalExcluido).toBe(2500.0);
    expect(consolidado.totalPeriodoEfetivo).toBe(150.0);
  });

  it('3. Inclusão Manual e Restauração: Usuário pesquisa lançamento, inclui na exclusão e depois restaura', async () => {
    const mov = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        categoriaId: catAlimentacaoId,
        dataMovimento: new Date('2026-08-10T12:00:00Z'),
        competencia: '2026-08',
        descricao: 'Compra Pontual Notebook para Estudos',
        valor: 4500.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
      },
    });

    // 1. Pesquisa de lançamentos
    const pesquisa = await mediaMensalService.pesquisarLancamentos(usuarioId, {
      termo: 'Notebook',
    });
    expect(pesquisa.length).toBe(1);
    expect(pesquisa[0].id).toBe(mov.id);
    expect(pesquisa[0].excluidoDaMedia).toBe(false);

    // 2. Inclui exclusão manual
    const exclusao = await mediaMensalService.incluirExclusaoManual(
      usuarioId,
      mov.id,
      'Notebook foi compra pontual de 5 anos'
    );
    expect(exclusao.origem).toBe('MANUAL');
    expect(exclusao.ativo).toBe(true);

    // Verifica se a tabela consolidada foi recalculada
    let medias = await mediaMensalService.obterMediasConsolidadas(usuarioId, '2026-10', 6);
    expect(medias.global?.totalExcluido).toBe(4500.0);

    // 3. Usuário decide restaurar (remove exclusão)
    await mediaMensalService.removerExclusao(usuarioId, exclusao.id);

    medias = await mediaMensalService.obterMediasConsolidadas(usuarioId, '2026-10', 6);
    expect(medias.global?.totalExcluido).toBe(0.0);
  });

  it('4. Worker acionado via EventBus: Deve recalcular após Login e após Importação de Arquivos', async () => {
    mediaMensalWorkerService.setupEventListener();

    await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        categoriaId: catAlimentacaoId,
        dataMovimento: new Date('2026-09-01T12:00:00Z'),
        competencia: '2026-09',
        descricao: 'Mercado Mensal Setembro',
        valor: 1200.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
      },
    });

    // Dispara evento de login
    authEventBus.emitUsuarioAutenticado({
      usuarioId,
      email: 'teste@evolvi.app',
      timestamp: new Date(),
    });

    // Aguarda execução assíncrona do worker
    await new Promise((resolve) => setTimeout(resolve, 300));

    const tabelaConsolidadaLogin = await prisma.mediaMensalConsolidada.findFirst({
      where: { usuarioId, categoriaId: null },
    });
    expect(tabelaConsolidadaLogin).not.toBeNull();
    expect(Number(tabelaConsolidadaLogin?.totalPeriodoBruto)).toBe(1200.0);

    // Dispara evento de arquivo importado
    importacaoEventBus.emitArquivoConsolidadoFinal({
      loteId: 'lote-123',
      arquivoId: 'arq-123',
      usuarioId,
      nomeArquivo: 'extrato_out.ofx',
      timestamp: new Date(),
    });

    await new Promise((resolve) => setTimeout(resolve, 300));

    mediaMensalWorkerService.removeEventListener();
  });

  it('5. Endpoints HTTP da API /api/media-mensal', async () => {
    // Testar GET /api/media-mensal/consolidado
    const resConsolidado = await app.inject({
      method: 'GET',
      url: '/api/media-mensal/consolidado',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resConsolidado.statusCode).toBe(200);
    const bodyConsolidado = JSON.parse(resConsolidado.body);
    expect(bodyConsolidado.mesesJanela).toBeDefined();

    // Testar POST /api/media-mensal/regras
    const resCriarRegra = await app.inject({
      method: 'POST',
      url: '/api/media-mensal/regras',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        descricaoPadrao: 'HOSPEDAGEM',
        valorMinimo: 500.0,
        apenasUmaVez: true,
        motivo: 'Viagem de férias única',
      },
    });
    expect(resCriarRegra.statusCode).toBe(201);
    const regraCriada = JSON.parse(resCriarRegra.body);
    expect(regraCriada.descricaoPadrao).toBe('HOSPEDAGEM');

    // Testar GET /api/media-mensal/regras
    const resListarRegras = await app.inject({
      method: 'GET',
      url: '/api/media-mensal/regras',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resListarRegras.statusCode).toBe(200);
    expect(JSON.parse(resListarRegras.body).length).toBe(1);

    // Testar DELETE /api/media-mensal/regras/:id
    const resDelRegra = await app.inject({
      method: 'DELETE',
      url: `/api/media-mensal/regras/${regraCriada.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resDelRegra.statusCode).toBe(200);
  });
});
