import { describe, it, expect, beforeAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';

describe('Motor de Histórico 6M (M-004) e Análise de Consumo (TASK-13)', () => {
  let app: FastifyInstance;

  const testUser = {
    nome: 'Usuario Historico 6M',
    email: `historico_6m_${Date.now()}@teste.com`,
    senha: 'SenhaForte123!',
    rendaBaseMensal: 11000.0,
  };

  const secondUser = {
    nome: 'Usuario Invasor Historico',
    email: `invasor_hist_${Date.now()}@teste.com`,
    senha: 'SenhaForte123!',
    rendaBaseMensal: 6000.0,
  };

  let tokenUser: string;
  let usuarioId: string;
  let tokenInvasor: string;
  let invasorId: string;

  let contaCorrenteId: string;
  let cartaoCreditoId: string;
  let catMoradiaId: string;
  let catAlimentacaoId: string;
  let catTransporteId: string;
  let catEducacaoId: string;
  let subAluguelId: string;
  let subSupermercadoId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Cadastrar usuários
    const respUser = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: testUser,
    });
    const bodyUser = JSON.parse(respUser.body);
    tokenUser = bodyUser.token;
    usuarioId = bodyUser.usuario.id;

    const respInvasor = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: secondUser,
    });
    const bodyInvasor = JSON.parse(respInvasor.body);
    tokenInvasor = bodyInvasor.token;
    invasorId = bodyInvasor.usuario.id;

    // 2. Criar contas (corrente e cartão)
    const respCC = await app.inject({
      method: 'POST',
      url: '/api/contas',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload: {
        nome: 'Conta Corrente Principal',
        tipo: 'CONTA_CORRENTE',
        saldoInicial: 50000.0,
      },
    });
    contaCorrenteId = JSON.parse(respCC.body).conta.id;

    const respCartao = await app.inject({
      method: 'POST',
      url: '/api/contas',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload: {
        nome: 'Cartão Black Visa',
        tipo: 'CARTAO_CREDITO',
        diaFechamento: 25,
        diaVencimento: 5,
        limiteCredito: 30000.0,
      },
    });
    cartaoCreditoId = JSON.parse(respCartao.body).conta.id;

    // 3. Obter categorias e subcategorias
    const catMoradia = await prisma.categoria.findFirst({
      where: { nome: { contains: 'Habitação', mode: 'insensitive' }, categoriaPaiId: null },
    });
    catMoradiaId = catMoradia ? catMoradia.id : (await prisma.categoria.findFirst({ where: { categoriaPaiId: null } }))!.id;

    const catAlim = await prisma.categoria.findFirst({
      where: { nome: { contains: 'Alimentação', mode: 'insensitive' }, categoriaPaiId: null },
    });
    catAlimentacaoId = catAlim ? catAlim.id : catMoradiaId;

    const catTransp = await prisma.categoria.findFirst({
      where: { nome: { contains: 'Transporte', mode: 'insensitive' }, categoriaPaiId: null },
    });
    catTransporteId = catTransp ? catTransp.id : catMoradiaId;

    const catEduc = await prisma.categoria.findFirst({
      where: { nome: { contains: 'Educação', mode: 'insensitive' }, categoriaPaiId: null },
    });
    catEducacaoId = catEduc ? catEduc.id : catMoradiaId;

    const subAluguel = await prisma.categoria.findFirst({
      where: { categoriaPaiId: catMoradiaId },
    });
    subAluguelId = subAluguel ? subAluguel.id : catMoradiaId;

    const subSuper = await prisma.categoria.findFirst({
      where: { categoriaPaiId: catAlimentacaoId },
    });
    subSupermercadoId = subSuper ? subSuper.id : catAlimentacaoId;

    // Injetar dados correspondentes exatamente à planilha real nos 6 meses fechados (2026-03 a 2026-08):
    // 2026-03: R$ 19.018,40 desp, R$ 7.227,93 rec
    // Valores da Analise_Consumo (despesas brutas que fecham em 99.692,71):
    // 2026-03: R$ 19.751,77 desp, R$ 7.227,93 rec
    // 2026-04: R$ 10.404,10 desp, R$ 9.525,17 rec
    // 2026-05: R$ 22.006,60 desp, R$ 42.680,75 rec
    // 2026-06: R$ 19.075,43 desp, R$ 1.264,44 rec
    // 2026-07: R$ 14.449,26 desp, R$ 47.589,33 rec
    // 2026-08: R$ 14.005,55 desp, R$ 7.705,10 rec
    // Total Despesas 6M: 99.692,71 | Média Despesas: 16.615,45
    // Total Receitas 6M: 115.992,72 | Média Receitas: 19.332,12

    const dadosFechados = [
      { comp: '2026-03', desp: 19751.77, rec: 7227.93 },
      { comp: '2026-04', desp: 10404.10, rec: 9525.17 },
      { comp: '2026-05', desp: 22006.60, rec: 42680.75 },
      { comp: '2026-06', desp: 19075.43, rec: 1264.44 },
      { comp: '2026-07', desp: 14449.26, rec: 47589.33 },
      { comp: '2026-08', desp: 14005.55, rec: 7705.10 },
    ];

    for (const d of dadosFechados) {
      // Receita
      await prisma.movimento.create({
        data: {
          usuarioId,
          contaId: contaCorrenteId,
          natureza: 'RECEITA',
          status: 'CONCILIADO',
          valor: d.rec,
          dataMovimento: new Date(`${d.comp}-05T12:00:00Z`),
          competencia: d.comp,
          descricao: `Salário / Receitas de ${d.comp}`,
        },
      });

      // Distribuir a despesa entre moradia (com sub aluguel) e alimentação (com sub supermercado)
      const parteMoradia = Number((d.desp * 0.6).toFixed(2));
      const parteAlim = Number((d.desp - parteMoradia).toFixed(2));

      await prisma.movimento.create({
        data: {
          usuarioId,
          contaId: contaCorrenteId,
          categoriaId: subAluguelId,
          natureza: 'DESPESA',
          status: 'CONCILIADO',
          valor: parteMoradia,
          dataMovimento: new Date(`${d.comp}-10T12:00:00Z`),
          competencia: d.comp,
          descricao: `Moradia / Aluguel de ${d.comp}`,
        },
      });

      await prisma.movimento.create({
        data: {
          usuarioId,
          contaId: cartaoCreditoId,
          categoriaId: subSupermercadoId,
          natureza: 'DESPESA',
          status: 'CONCILIADO',
          valor: parteAlim,
          dataMovimento: new Date(`${d.comp}-15T12:00:00Z`),
          competencia: d.comp,
          descricao: `Alimentação Supermercado de ${d.comp}`,
        },
      });
    }

    // Adicionar transferências internas e pagamento de fatura para garantir ANTI-DUPLA CONTAGEM
    await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: contaCorrenteId,
        natureza: 'TRANSFERENCIA_PROPRIA',
        status: 'CONCILIADO',
        valor: 8000.0,
        dataMovimento: new Date('2026-05-12T12:00:00Z'),
        competencia: '2026-05',
        descricao: 'Transferência entre contas próprias',
      },
    });

    // Movimento no mês corrente aberto (2026-09)
    await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: contaCorrenteId,
        categoriaId: subAluguelId,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        valor: 4200.0,
        dataMovimento: new Date('2026-09-08T12:00:00Z'),
        competencia: '2026-09',
        descricao: 'Aluguel do mês corrente aberto 2026-09',
      },
    });

    // Inserir movimento no invasor para verificar isolamento multi-tenant
    const respContaInvasor = await app.inject({
      method: 'POST',
      url: '/api/contas',
      headers: { authorization: `Bearer ${tokenInvasor}` },
      payload: {
        nome: 'Conta Invasor',
        tipo: 'CONTA_CORRENTE',
        saldoInicial: 1000.0,
      },
    });
    const contaInvasorId = JSON.parse(respContaInvasor.body).conta.id;

    await prisma.movimento.create({
      data: {
        usuarioId: invasorId,
        contaId: contaInvasorId,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        valor: 99999.0,
        dataMovimento: new Date('2026-05-10T12:00:00Z'),
        competencia: '2026-05',
        descricao: 'Despesa Invasor não deve vazar',
      },
    });
  });

  it('GET /api/fase1/historico/resumo deve calcular exatamente os 6 meses fechados da planilha real sem vazar transferências ou outros usuários', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/fase1/historico/resumo?competenciaReferencia=2026-09&mesesJanela=6',
      headers: { authorization: `Bearer ${tokenUser}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    // Validações da Janela N=6
    expect(body.janela.total_meses).toBe(6);
    expect(body.janela.inicio).toBe('2026-03');
    expect(body.janela.fim).toBe('2026-08');
    expect(body.janela.meses_fechados).toEqual([
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
    ]);

    // Totais e Médias com base nos dados reais da planilha Controle_Financeiro.xlsx
    expect(body.total_periodo_despesas).toBe(99692.71);
    expect(body.media_mensal_despesas).toBe(16615.45);
    expect(body.total_periodo_receitas).toBe(115992.72);
    expect(body.media_mensal_receitas).toBe(19332.12);

    // Quantidade total de lançamentos de despesa (2 por mês nos 6 meses = 12)
    expect(body.quantidade_total_lancamentos).toBe(12);
    expect(body.ticket_medio_global).toBeCloseTo(99692.71 / 12, 1);

    // Fechamentos mês a mês
    expect(body.fechamentos_mensais).toHaveLength(6);
    const fechMar = body.fechamentos_mensais.find((f: any) => f.competencia === '2026-03');
    expect(fechMar).toBeDefined();
    expect(fechMar.totalDespesas).toBe(19751.77);
    expect(fechMar.totalReceitas).toBe(7227.93);
    expect(fechMar.saldoMes).toBe(Number((7227.93 - 19751.77).toFixed(2)));

    // Comparativo com mês corrente aberto (2026-09)
    expect(body.comparativo_mes_aberto).toBeDefined();
    expect(body.comparativo_mes_aberto.competencia).toBe('2026-09');
    expect(body.comparativo_mes_aberto.totalDespesas).toBe(4200.0);
    expect(body.comparativo_mes_aberto.diferencaDespesaVsMedia).toBe(4200.0 - 16615.45);
  });

  it('GET /api/fase1/historico/categorias deve decompor analiticamente por categoria e subcategoria POF com tickets médios', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/fase1/historico/categorias?competenciaReferencia=2026-09&mesesJanela=6',
      headers: { authorization: `Bearer ${tokenUser}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.total_periodo).toBe(99692.71);
    expect(body.media_mensal).toBe(16615.45);
    expect(body.categorias.length).toBeGreaterThan(0);

    // Primeira categoria com maior gasto
    const catTopo = body.categorias[0];
    expect(catTopo.total_periodo).toBeGreaterThan(0);
    expect(catTopo.percentual_participacao).toBeGreaterThan(0);
    expect(catTopo.ticket_medio_lancamento).toBeGreaterThan(0);

    // Conferir que as subcategorias estão populadas
    const catComSub = body.categorias.find((c: any) => c.subcategorias && c.subcategorias.length > 0);
    expect(catComSub).toBeDefined();
    const sub = catComSub.subcategorias.find((s: any) => s.total_periodo > 0);
    expect(sub).toBeDefined();
    expect(sub.total_periodo).toBeGreaterThan(0);
    expect(sub.quantidade_lancamentos).toBeGreaterThan(0);
    expect(sub.ticket_medio_lancamento).toBeGreaterThan(0);
  });

  it('Isolamento Multi-tenant: Usuário secundário não vê despesas do usuário principal', async () => {
    const responseInvasor = await app.inject({
      method: 'GET',
      url: '/api/fase1/historico/resumo?competenciaReferencia=2026-09&mesesJanela=6',
      headers: { authorization: `Bearer ${tokenInvasor}` },
    });

    expect(responseInvasor.statusCode).toBe(200);
    const bodyInvasor = JSON.parse(responseInvasor.body);

    // O invasor só tem R$ 99.999 em 2026-05 e não vê os 99.692,71 do outro usuário
    expect(bodyInvasor.total_periodo_despesas).toBe(99999.0);
    expect(bodyInvasor.media_mensal_despesas).toBe(16666.5);
  });

  it('Validação de Erro 400 com parâmetro inválido de competência', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/fase1/historico/resumo?competenciaReferencia=invalido',
      headers: { authorization: `Bearer ${tokenUser}` },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Bad Request');
  });
});
