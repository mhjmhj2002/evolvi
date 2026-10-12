import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';

describe('Motor de Diagnóstico Baseline N=6 e Semáforo (TASK-07)', () => {
  let app: FastifyInstance;

  const testUser = {
    nome: 'Usuario Baseline Teste',
    email: `baseline_${Date.now()}@teste.com`,
    senha: 'SenhaForte123!',
    rendaBaseMensal: 11000.0,
  };

  const secondUser = {
    nome: 'Usuario Invasor Baseline',
    email: `invasor_base_${Date.now()}@teste.com`,
    senha: 'SenhaForte456!',
    rendaBaseMensal: 5000.0,
  };

  let tokenUser: string;
  let usuarioId: string;
  let tokenInvasor: string;
  let invasorId: string;

  let contaId: string;
  let catMoradiaId: string;
  let catAlimentacaoId: string;
  let catTransporteId: string;
  let subAlimentacaoId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Cadastrar usuário principal
    const respUser = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: testUser,
    });
    const bodyUser = JSON.parse(respUser.body);
    tokenUser = bodyUser.token;
    usuarioId = bodyUser.usuario.id;

    // 2. Cadastrar segundo usuário (para teste de isolamento multi-tenant)
    const respInvasor = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: secondUser,
    });
    const bodyInvasor = JSON.parse(respInvasor.body);
    tokenInvasor = bodyInvasor.token;
    invasorId = bodyInvasor.usuario.id;

    // 3. Criar conta para usuário principal
    const respConta = await app.inject({
      method: 'POST',
      url: '/api/contas',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload: {
        nome: 'Banco do Brasil Diagnostico',
        tipo: 'CONTA_CORRENTE',
        saldoInicial: 10000.0,
      },
    });
    contaId = JSON.parse(respConta.body).conta.id;

    // 4. Buscar categorias raiz do seed
    const moradia = await prisma.categoria.findFirst({
      where: { nome: 'Moradia', categoriaPaiId: null },
    });
    const alimentacao = await prisma.categoria.findFirst({
      where: { nome: 'Alimentacao', categoriaPaiId: null },
    });
    const transporte = await prisma.categoria.findFirst({
      where: { nome: 'Transporte', categoriaPaiId: null },
    });

    if (!moradia || !alimentacao || !transporte) {
      throw new Error('Categorias POF essenciais não encontradas no banco');
    }

    catMoradiaId = moradia.id;
    catAlimentacaoId = alimentacao.id;
    catTransporteId = transporte.id;

    // Buscar uma subcategoria de Alimentacao para testar agregação pai/filho
    const subCat = await prisma.categoria.findFirst({
      where: { categoriaPaiId: catAlimentacaoId },
    });
    if (subCat) {
      subAlimentacaoId = subCat.id;
    }
  });

  afterAll(async () => {
    if (usuarioId || invasorId) {
      await prisma.usuario.deleteMany({
        where: {
          id: { in: [usuarioId, invasorId].filter(Boolean) },
        },
      });
    }
    await app.close();
  });

  it('deve retornar baseline zerado quando usuário não tem movimentos registrados', async () => {
    const resp = await app.inject({
      method: 'GET',
      url: '/api/fase1/baseline?competenciaReferencia=2026-10',
      headers: { authorization: `Bearer ${tokenUser}` },
    });

    expect(resp.statusCode).toBe(200);
    const data = JSON.parse(resp.body);

    expect(data.renda_base).toBe(11000.0);
    expect(data.meses_analisados).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
    expect(data.total_periodo).toBe(0);
    expect(data.media_mensal).toBe(0);
    expect(data.gap_zero_a_zero).toBe(-11000.0); // Sobrando 11k
    expect(data.pct_excesso_renda).toBe(-100.0);
    expect(data.detalhes_categorias.length).toBe(21);
  });

  it('deve calcular média N=6, gap do zero a zero e agregação por subcategoria corretamente', async () => {
    // Inserir despesas na janela N=6 (2026-04 até 2026-09)
    // 6 meses * 4.000 em Moradia = 24.000 (média 4.000)
    // 6 meses * 3.000 em Alimentacao (via subcategoria) = 18.000 (média 3.000)
    // 6 meses * 1.000 em Transporte = 6.000 (média 1.000)
    // Total período: 48.000 / 6 = 8.000 média mensal
    // Renda = 11.000 -> Gap = 8.000 - 11.000 = -3.000 (sem excesso)

    const meses = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
    for (const mes of meses) {
      await prisma.movimento.createMany({
        data: [
          {
            usuarioId,
            contaId,
            categoriaId: catMoradiaId,
            dataMovimento: new Date(`${mes}-10T12:00:00Z`),
            competencia: mes,
            descricao: `Aluguel ${mes}`,
            valor: 4000.0,
            natureza: 'DESPESA',
            status: 'CONCILIADO',
          },
          {
            usuarioId,
            contaId,
            categoriaId: subAlimentacaoId || catAlimentacaoId, // Testar vínculo pela subcategoria
            dataMovimento: new Date(`${mes}-15T12:00:00Z`),
            competencia: mes,
            descricao: `Supermercado ${mes}`,
            valor: 3000.0,
            natureza: 'DESPESA',
            status: 'CONCILIADO',
          },
          {
            usuarioId,
            contaId,
            categoriaId: catTransporteId,
            dataMovimento: new Date(`${mes}-20T12:00:00Z`),
            competencia: mes,
            descricao: `Combustivel ${mes}`,
            valor: 1000.0,
            natureza: 'DESPESA',
            status: 'CONCILIADO',
          },
        ],
      });
    }

    // Inserir movimento no mês aberto (2026-10) que NÃO deve entrar na média N=6
    await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        categoriaId: catMoradiaId,
        dataMovimento: new Date('2026-10-02T12:00:00Z'),
        competencia: '2026-10',
        descricao: 'Aluguel Outubro Aberto',
        valor: 9999.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
      },
    });

    // Inserir receita e transferência própria que NÃO devem entrar nas despesas de consumo
    await prisma.movimento.createMany({
      data: [
        {
          usuarioId,
          contaId,
          dataMovimento: new Date('2026-05-01T12:00:00Z'),
          competencia: '2026-05',
          descricao: 'Salario Recebido',
          valor: 11000.0,
          natureza: 'RECEITA',
          status: 'CONCILIADO',
        },
        {
          usuarioId,
          contaId,
          dataMovimento: new Date('2026-05-05T12:00:00Z'),
          competencia: '2026-05',
          descricao: 'Transferência para Reserva',
          valor: 2000.0,
          natureza: 'TRANSFERENCIA_PROPRIA',
          status: 'CONCILIADO',
        },
      ],
    });

    const resp = await app.inject({
      method: 'GET',
      url: '/api/fase1/baseline?competenciaReferencia=2026-10',
      headers: { authorization: `Bearer ${tokenUser}` },
    });

    expect(resp.statusCode).toBe(200);
    const data = JSON.parse(resp.body);

    expect(data.renda_base).toBe(11000.0);
    expect(data.total_periodo).toBe(48000.0);
    expect(data.media_mensal).toBe(8000.0);
    expect(data.gap_zero_a_zero).toBe(-3000.0);
    expect(data.pct_excesso_renda).toBe(-27.27);

    // Verificar detalhe por categoria
    const detMoradia = data.detalhes_categorias.find((d: any) => d.categoria_id === catMoradiaId);
    expect(detMoradia.total_periodo).toBe(24000.0);
    expect(detMoradia.media_mensal).toBe(4000.0);

    const detAlimentacao = data.detalhes_categorias.find(
      (d: any) => d.categoria_id === catAlimentacaoId
    );
    expect(detAlimentacao.total_periodo).toBe(18000.0);
    expect(detAlimentacao.media_mensal).toBe(3000.0);

    const detTransporte = data.detalhes_categorias.find(
      (d: any) => d.categoria_id === catTransporteId
    );
    expect(detTransporte.total_periodo).toBe(6000.0);
    expect(detTransporte.media_mensal).toBe(1000.0);
  });

  it('deve gerar a matriz de semáforo com as 21 categorias classificadas rigorosamente', async () => {
    const resp = await app.inject({
      method: 'GET',
      url: '/api/fase1/semaforo?competenciaReferencia=2026-10',
      headers: { authorization: `Bearer ${tokenUser}` },
    });

    expect(resp.statusCode).toBe(200);
    const data = JSON.parse(resp.body);

    expect(data.total_categorias).toBe(21);
    expect(data.renda_base).toBe(11000.0);
    expect(data.media_mensal_total).toBe(8000.0);

    // Verificar que todas as 21 categorias têm status válido sem nulls
    const validStatuses = ['VERDE', 'AMARELO', 'VERMELHO'];
    for (const cat of data.categorias) {
      expect(validStatuses).toContain(cat.status_semaforo);
      expect(typeof cat.diferenca_pp).toBe('number');
      expect(typeof cat.referencia_normalizada_pct).toBe('number');
      expect(typeof cat.pct_gasto_atual).toBe('number');
    }

    // Verificar soma das referências normalizadas = 100.00%
    const somaRef = data.categorias.reduce(
      (acc: number, c: any) => acc + c.referencia_normalizada_pct,
      0
    );
    expect(Number(somaRef.toFixed(2))).toBe(100.00);

    // Moradia: Gasto 4.000 / 8.000 = 50.00%. Referência normalizada = 24.47%.
    // Delta = 50.00 - 24.47 = +25.53 p.p. (> +5) -> VERMELHO
    const catMoradia = data.categorias.find((c: any) => c.categoria_id === catMoradiaId);
    expect(catMoradia.pct_gasto_atual).toBe(50.0);
    expect(catMoradia.referencia_normalizada_pct).toBe(24.47);
    expect(catMoradia.diferenca_pp).toBe(25.53);
    expect(catMoradia.status_semaforo).toBe('VERMELHO');

    // Alimentacao: Gasto 3.000 / 8.000 = 37.50%. Referência normalizada = 21.32%.
    // Delta = 37.50 - 21.32 = +16.18 p.p. (> +5) -> VERMELHO
    const catAlimentacao = data.categorias.find((c: any) => c.categoria_id === catAlimentacaoId);
    expect(catAlimentacao.pct_gasto_atual).toBe(37.5);
    expect(catAlimentacao.referencia_normalizada_pct).toBe(21.32);
    expect(catAlimentacao.diferenca_pp).toBe(16.18);
    expect(catAlimentacao.status_semaforo).toBe('VERMELHO');

    // Transporte: Referência normalizada = 8.36%. Gasto 1.000 / 8.000 = 12.50%.
    // Delta = 12.50 - 8.36 = +4.14 p.p. (entre -5 e +5) -> AMARELO
    const catTransporte = data.categorias.find((c: any) => c.categoria_id === catTransporteId);
    expect(catTransporte.pct_gasto_atual).toBe(12.5);
    expect(catTransporte.referencia_normalizada_pct).toBe(8.36);
    expect(catTransporte.diferenca_pp).toBe(4.14);
    expect(catTransporte.status_semaforo).toBe('AMARELO');

    // Categoria com gasto 0 e referência > 5.0%: ex: Viagem com ref 12.89%
    // Delta = 0.0 - 12.89 = -12.89 p.p. (< -5) -> VERDE
    const catViagem = data.categorias.find((c: any) => c.nome === 'Viagem');
    expect(catViagem.pct_gasto_atual).toBe(0.0);
    expect(catViagem.referencia_normalizada_pct).toBe(12.89);
    expect(catViagem.diferenca_pp).toBe(-12.89);
    expect(catViagem.status_semaforo).toBe('VERDE');
  });

  it('deve garantir isolamento de contexto (usuário invasor não vê dados do usuário principal)', async () => {
    const resp = await app.inject({
      method: 'GET',
      url: '/api/fase1/baseline?competenciaReferencia=2026-10',
      headers: { authorization: `Bearer ${tokenInvasor}` },
    });

    expect(resp.statusCode).toBe(200);
    const data = JSON.parse(resp.body);

    expect(data.renda_base).toBe(5000.0);
    expect(data.total_periodo).toBe(0);
    expect(data.media_mensal).toBe(0);
    expect(data.gap_zero_a_zero).toBe(-5000.0);
  });

  it('deve rejeitar formato inválido de competência de referência', async () => {
    const resp = await app.inject({
      method: 'GET',
      url: '/api/fase1/baseline?competenciaReferencia=2026-13-99',
      headers: { authorization: `Bearer ${tokenUser}` },
    });

    expect(resp.statusCode).toBe(400);
    const body = JSON.parse(resp.body);
    expect(body.error).toBe('Bad Request');
  });
});
