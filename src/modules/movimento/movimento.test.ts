import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';

describe('Motor de Movimentos e Anti-Dupla Contagem (TASK-05)', () => {
  let app: FastifyInstance;

  const testUser = {
    nome: 'Usuario Movimentos Teste',
    email: `movimentos_${Date.now()}@teste.com`,
    senha: 'SenhaForte123!',
    rendaBaseMensal: 8000.0,
  };

  const secondUser = {
    nome: 'Usuario Invasor Movimentos',
    email: `invasor_${Date.now()}@teste.com`,
    senha: 'SenhaForte456!',
    rendaBaseMensal: 3000.0,
  };

  let tokenUser: string;
  let userId: string;
  let tokenInvasor: string;
  let invasorId: string;

  let contaCorrenteId: string;
  let cartaoCreditoId: string;
  let categoriaAlimentacaoId: string;

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
    userId = bodyUser.usuario.id;

    // 2. Cadastrar usuário invasor
    const respInvasor = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: secondUser,
    });
    const bodyInvasor = JSON.parse(respInvasor.body);
    tokenInvasor = bodyInvasor.token;
    invasorId = bodyInvasor.usuario.id;

    // 3. Criar conta corrente para o usuário principal
    const respCC = await app.inject({
      method: 'POST',
      url: '/api/contas',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload: {
        nome: 'Banco do Brasil CC',
        tipo: 'CONTA_CORRENTE',
        saldoInicial: 5000.0,
      },
    });
    contaCorrenteId = JSON.parse(respCC.body).conta.id;

    // 4. Criar cartão de crédito para o usuário principal
    const respCartao = await app.inject({
      method: 'POST',
      url: '/api/contas',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload: {
        nome: 'Cartão Nubank Ultravioleta',
        tipo: 'CARTAO_CREDITO',
        diaFechamento: 25,
        diaVencimento: 5,
        saldoInicial: 0.0,
      },
    });
    cartaoCreditoId = JSON.parse(respCartao.body).conta.id;

    // 5. Obter categoria de Alimentação existente do seed POF
    const cat = await prisma.categoria.findFirst({
      where: { nome: 'Alimentação' },
    });
    if (cat) {
      categoriaAlimentacaoId = cat.id;
    }
  });

  afterAll(async () => {
    if (userId || invasorId) {
      await prisma.usuario.deleteMany({
        where: {
          id: { in: [userId, invasorId].filter(Boolean) },
        },
      });
    }
    await app.close();
  });

  it('deve registrar compra no cartão de crédito como DESPESA de consumo', async () => {
    const payload = {
      contaId: cartaoCreditoId,
      categoriaId: categoriaAlimentacaoId,
      dataMovimento: '2026-10-05',
      descricao: 'Supermercado Mensal',
      valor: 850.5,
      natureza: 'DESPESA',
      status: 'CONCILIADO',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/movimentos',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload,
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.movimento).toBeDefined();
    expect(body.movimento.valor).toBe(850.5);
    expect(body.movimento.natureza).toBe('DESPESA');
    expect(body.movimento.competencia).toBe('2026-10');
  });

  it('deve registrar pagamento de fatura do cartão como TRANSFERENCIA_PROPRIA evitando dupla contagem', async () => {
    const payload = {
      contaId: contaCorrenteId,
      contaDestinoId: cartaoCreditoId,
      dataMovimento: '2026-10-10',
      descricao: 'Pagamento Fatura Outubro',
      valor: 850.5,
      natureza: 'TRANSFERENCIA_PROPRIA',
      isPagamentoFatura: true,
      status: 'CONCILIADO',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/movimentos',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload,
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.movimento.natureza).toBe('TRANSFERENCIA_PROPRIA');
    expect(body.contrapartida.natureza).toBe('TRANSFERENCIA_PROPRIA');
    expect(body.movimento.transferenciaVinculoId).toBe(body.contrapartida.id);
    expect(body.contrapartida.transferenciaVinculoId).toBe(body.movimento.id);
  });

  it('no extrato por competência, o consumo real deve contabilizar apenas os 850.50 e não dobrar com a fatura', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/movimentos?competencia=2026-10',
      headers: { authorization: `Bearer ${tokenUser}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    // O consumo real deve ser estritamente os 850.50 da compra
    expect(body.resumo.totalDespesasConsumo).toBe(850.5);
    // As transferências/fatura somam 1701 (saída na CC de 850.50 e entrada no Cartão de 850.50) e ficam isoladas
    expect(body.resumo.totalTransferenciasProprias).toBe(1701.0);
  });

  it('deve rejeitar inserção com mesma chave_dedupe já cadastrada', async () => {
    const payload = {
      contaId: contaCorrenteId,
      dataMovimento: '2026-10-12',
      descricao: 'Assinatura Software',
      valor: 120.0,
      natureza: 'DESPESA',
      chaveDedupe: 'dedupe-token-12345',
    };

    const firstResp = await app.inject({
      method: 'POST',
      url: '/api/movimentos',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload,
    });
    expect(firstResp.statusCode).toBe(201);

    // Segunda tentativa idêntica
    const secondResp = await app.inject({
      method: 'POST',
      url: '/api/movimentos',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload,
    });

    expect(secondResp.statusCode).toBe(409);
    const errorBody = JSON.parse(secondResp.body);
    expect(errorBody.message).toContain('Movimento duplicado detectado');
  });

  it('deve realizar importação em lote ignorando automaticamente itens repetidos por deduplicação', async () => {
    const payloadLote = {
      origemDocumento: 'extrato_outubro.ofx',
      movimentos: [
        {
          contaId: contaCorrenteId,
          dataMovimento: '2026-10-15',
          descricao: 'Padaria da Esquina',
          valor: 35.0,
          natureza: 'DESPESA',
          chaveDedupe: 'ofx-item-01',
        },
        {
          contaId: contaCorrenteId,
          dataMovimento: '2026-10-16',
          descricao: 'Farmácia Central',
          valor: 92.4,
          natureza: 'DESPESA',
          chaveDedupe: 'ofx-item-02',
        },
        // Tentativa de duplicata do primeiro item
        {
          contaId: contaCorrenteId,
          dataMovimento: '2026-10-15',
          descricao: 'Padaria da Esquina',
          valor: 35.0,
          natureza: 'DESPESA',
          chaveDedupe: 'ofx-item-01',
        },
      ],
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/movimentos/importar',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload: payloadLote,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.resumo.totalProcessado).toBe(3);
    expect(body.resumo.inseridos).toBe(2);
    expect(body.resumo.ignoradosPorDedupe).toBe(1);
  });

  it('deve isolar movimentos entre usuários diferentes (Tenant Isolation)', async () => {
    // Invasor tentando buscar movimentos do usuário principal
    const response = await app.inject({
      method: 'GET',
      url: '/api/movimentos?competencia=2026-10',
      headers: { authorization: `Bearer ${tokenInvasor}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.movimentos).toHaveLength(0);
    expect(body.resumo.totalDespesasConsumo).toBe(0);
  });

  it('ao excluir um movimento de transferência vinculada, deve remover ambas as pontas', async () => {
    // 1. Criar transferência entre contas
    const respTransf = await app.inject({
      method: 'POST',
      url: '/api/movimentos',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload: {
        contaId: contaCorrenteId,
        contaDestinoId: cartaoCreditoId,
        dataMovimento: '2026-10-20',
        descricao: 'Transferência para teste de deleção',
        valor: 300.0,
        natureza: 'TRANSFERENCIA_PROPRIA',
        chaveDedupe: `dedupe-del-${Date.now()}`,
      },
    });

    expect(respTransf.statusCode).toBe(201);
    const { movimento, contrapartida } = JSON.parse(respTransf.body);

    // 2. Deletar movimento de saída
    const respDel = await app.inject({
      method: 'DELETE',
      url: `/api/movimentos/${movimento.id}`,
      headers: { authorization: `Bearer ${tokenUser}` },
    });

    expect(respDel.statusCode).toBe(200);

    // 3. Confirmar que a contrapartida também foi removida
    const checkContrapartida = await prisma.movimento.findUnique({
      where: { id: contrapartida.id },
    });
    expect(checkContrapartida).toBeNull();
  });

  it('deve filtrar movimentos por intervalo de datas (dataInicio / dataFim) e busca textual', async () => {
    // 1. Criar dois lançamentos com datas e descrições distintas
    await app.inject({
      method: 'POST',
      url: '/api/movimentos',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload: {
        contaId: contaCorrenteId,
        dataMovimento: '2026-10-05',
        descricao: 'Supermercado Mensal Pão de Açúcar',
        valor: 450.0,
        natureza: 'DESPESA',
      },
    });

    await app.inject({
      method: 'POST',
      url: '/api/movimentos',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload: {
        contaId: contaCorrenteId,
        dataMovimento: '2026-10-25',
        descricao: 'Farmácia Droga Raia',
        valor: 85.0,
        natureza: 'DESPESA',
      },
    });

    // 2. Filtro por dataInicio e dataFim pegando apenas o dia 05
    const respData = await app.inject({
      method: 'GET',
      url: '/api/movimentos?dataInicio=2026-10-01&dataFim=2026-10-10',
      headers: { authorization: `Bearer ${tokenUser}` },
    });
    expect(respData.statusCode).toBe(200);
    const bodyData = JSON.parse(respData.body);
    const descricoesData = bodyData.movimentos.map((m: any) => m.descricao);
    expect(descricoesData).toContain('Supermercado Mensal Pão de Açúcar');
    expect(descricoesData).not.toContain('Farmácia Droga Raia');

    // 3. Filtro por busca textual
    const respBusca = await app.inject({
      method: 'GET',
      url: '/api/movimentos?busca=droga',
      headers: { authorization: `Bearer ${tokenUser}` },
    });
    expect(respBusca.statusCode).toBe(200);
    const bodyBusca = JSON.parse(respBusca.body);
    expect(bodyBusca.movimentos.length).toBe(1);
    expect(bodyBusca.movimentos[0].descricao).toBe('Farmácia Droga Raia');
  });

  describe('Rateio Analítico de Categorias / Transaction Splitting (TASK-39)', () => {
    let catSaudeId: string;
    let catTransporteId: string;
    let movParaSplitId: string;

    beforeAll(async () => {
      // Buscar categorias existentes do seed POF (21 categorias padrão)
      const todasCategorias = await prisma.categoria.findMany({
        where: { categoriaPaiId: null, usuarioId: null },
      });
      categoriaAlimentacaoId = todasCategorias.find((c) => /alim/i.test(c.nome))?.id || todasCategorias[0].id;
      catSaudeId = todasCategorias.find((c) => /saud/i.test(c.nome))?.id || todasCategorias[1].id;
      catTransporteId = todasCategorias.find((c) => /transp/i.test(c.nome))?.id || todasCategorias[2].id;

      // Criar lançamento base de R$ 300,00 para rateio
      const respMov = await app.inject({
        method: 'POST',
        url: '/api/movimentos',
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          contaId: contaCorrenteId,
          categoriaId: categoriaAlimentacaoId,
          dataMovimento: '2026-10-15',
          descricao: 'Compras Hipermercado Carrefour',
          valor: 300.0,
          natureza: 'DESPESA',
          status: 'CONCILIADO',
        },
      });
      movParaSplitId = JSON.parse(respMov.body).movimento.id;
    });

    it('deve rejeitar rateio se a soma das fatias for diferente do valor total do movimento', async () => {
      const resp = await app.inject({
        method: 'POST',
        url: `/api/movimentos/${movParaSplitId}/split`,
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          splits: [
            { categoriaId: categoriaAlimentacaoId, valor: 150.0, descricao: 'Alimentação' },
            { categoriaId: catSaudeId, valor: 100.0, descricao: 'Farmácia' },
          ], // Total: 250 != 300
        },
      });

      expect(resp.statusCode).toBe(400);
      const body = JSON.parse(resp.body);
      expect(body.message).toMatch(/soma dos valores/i);
    });

    it('deve rejeitar rateio se o movimento pertencer a outro usuário (isolamento multi-tenant)', async () => {
      const resp = await app.inject({
        method: 'POST',
        url: `/api/movimentos/${movParaSplitId}/split`,
        headers: { authorization: `Bearer ${tokenInvasor}` },
        payload: {
          splits: [
            { categoriaId: categoriaAlimentacaoId, valor: 200.0 },
            { categoriaId: catSaudeId, valor: 100.0 },
          ],
        },
      });

      expect(resp.statusCode).toBe(404);
    });

    it('deve desdobrar movimento com sucesso quando soma bater exatamente com valor original', async () => {
      const resp = await app.inject({
        method: 'POST',
        url: `/api/movimentos/${movParaSplitId}/split`,
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          splits: [
            { categoriaId: categoriaAlimentacaoId, valor: 180.5, descricao: 'Compras Alimentos' },
            { categoriaId: catSaudeId, valor: 79.5, descricao: 'Medicamentos' },
            { categoriaId: catTransporteId, valor: 40.0, descricao: 'Acessório para carro' },
          ], // Total = 180.5 + 79.5 + 40 = 300.0
        },
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);
      expect(body.sucesso).toBe(true);
      expect(body.rateios).toHaveLength(3);
      expect(body.rateios[0].valor).toBe(180.5);
      expect(body.rateios[1].valor).toBe(79.5);
      expect(body.rateios[2].valor).toBe(40.0);
    });

    it('deve retornar os rateios aninhados no GET /api/movimentos', async () => {
      const resp = await app.inject({
        method: 'GET',
        url: `/api/movimentos?busca=Carrefour`,
        headers: { authorization: `Bearer ${tokenUser}` },
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);
      const mov = body.movimentos.find((m: any) => m.id === movParaSplitId);
      expect(mov).toBeDefined();
      expect(mov.rateios).toBeDefined();
      expect(mov.rateios.length).toBe(3);
    });

    it('deve remover rateio e restaurar integridade simples via DELETE /api/movimentos/:id/split', async () => {
      const resp = await app.inject({
        method: 'DELETE',
        url: `/api/movimentos/${movParaSplitId}/split`,
        headers: { authorization: `Bearer ${tokenUser}` },
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);
      expect(body.sucesso).toBe(true);

      // Conferir no banco
      const countRateios = await prisma.movimentoRateio.count({
        where: { movimentoId: movParaSplitId },
      });
      expect(countRateios).toBe(0);
    });
  });

  describe('8. Propagação de Categoria por Vendedor / Estabelecimento (TASK-42)', () => {
    let movA1Id: string;
    let movA2Id: string;
    let movA3Id: string;
    let movBId: string; // Outro usuário para garantir multi-tenant
    let categoriaDestinoId: string;

    beforeAll(async () => {
      // Obter uma categoria válida diferente da de alimentação
      const cat = await prisma.categoria.findFirst({
        where: { id: { not: categoriaAlimentacaoId } },
      });
      categoriaDestinoId = cat?.id || categoriaAlimentacaoId;

      // Cria 3 compras com descrições variantes do mesmo comerciante para tokenUser
      const mov1 = await prisma.movimento.create({
        data: {
          usuarioId: userId,
          contaId: contaCorrenteId,
          dataMovimento: new Date('2026-08-01T00:00:00.000Z'),
          competencia: '2026-08',
          descricao: 'Compra no débito - BARRACA DO JULIO',
          valor: 10.0,
          natureza: 'DESPESA',
          categoriaId: null,
        },
      });
      movA1Id = mov1.id;

      const mov2 = await prisma.movimento.create({
        data: {
          usuarioId: userId,
          contaId: contaCorrenteId,
          dataMovimento: new Date('2026-08-15T00:00:00.000Z'),
          competencia: '2026-08',
          descricao: 'Barraca Do Julio Vila Velha Bra',
          valor: 10.0,
          natureza: 'DESPESA',
          categoriaId: null,
        },
      });
      movA2Id = mov2.id;

      const mov3 = await prisma.movimento.create({
        data: {
          usuarioId: userId,
          contaId: contaCorrenteId,
          dataMovimento: new Date('2026-08-22T00:00:00.000Z'),
          competencia: '2026-08',
          descricao: 'Compra no débito - BARRACA DO JULIO I',
          valor: 10.0,
          natureza: 'DESPESA',
          categoriaId: null,
        },
      });
      movA3Id = mov3.id;

      // Cria conta para o usuário invasor
      const contaInvasor = await prisma.conta.create({
        data: {
          usuarioId: invasorId,
          nome: 'Conta Invasor',
          tipo: 'CONTA_CORRENTE',
        },
      });

      // Movimento similar de outro usuário (não pode ser alterado)
      const movOutro = await prisma.movimento.create({
        data: {
          usuarioId: invasorId,
          contaId: contaInvasor.id,
          dataMovimento: new Date('2026-08-05T00:00:00.000Z'),
          competencia: '2026-08',
          descricao: 'Compra no débito - BARRACA DO JULIO',
          valor: 10.0,
          natureza: 'DESPESA',
          categoriaId: null,
        },
      });
      movBId = movOutro.id;
    });

    it('deve retornar quantidade de similares e termo vendedor via GET /:id/similares-vendedor', async () => {
      const resp = await app.inject({
        method: 'GET',
        url: `/api/movimentos/${movA1Id}/similares-vendedor`,
        headers: { authorization: `Bearer ${tokenUser}` },
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);
      expect(body.termoVendedor).toBe('BARRACA DO JULIO');
      expect(body.totalSimilares).toBe(2); // movA2 e movA3
    });

    it('deve atualizar categoria pontual sem propagar quando propagarMesmoVendedor for false', async () => {
      const resp = await app.inject({
        method: 'PUT',
        url: `/api/movimentos/${movA1Id}`,
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          categoriaId: categoriaAlimentacaoId,
          propagarMesmoVendedor: false,
        },
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);
      expect(body.totalPropagados).toBe(0);

      // Confere que movA2 permanece nulo
      const mov2 = await prisma.movimento.findUnique({ where: { id: movA2Id } });
      expect(mov2?.categoriaId).toBeNull();
    });

    it('deve atualizar e propagar categoria para todos os similares do usuário preservando multi-tenant', async () => {
      const resp = await app.inject({
        method: 'PUT',
        url: `/api/movimentos/${movA1Id}`,
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          categoriaId: categoriaDestinoId,
          propagarMesmoVendedor: true,
        },
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);
      expect(body.totalPropagados).toBe(2);
      expect(body.termoVendedor).toBe('BARRACA DO JULIO');

      // Confere que movA1, movA2 e movA3 foram atualizados para categoriaDestinoId
      const [m1, m2, m3] = await Promise.all([
        prisma.movimento.findUnique({ where: { id: movA1Id } }),
        prisma.movimento.findUnique({ where: { id: movA2Id } }),
        prisma.movimento.findUnique({ where: { id: movA3Id } }),
      ]);
      expect(m1?.categoriaId).toBe(categoriaDestinoId);
      expect(m2?.categoriaId).toBe(categoriaDestinoId);
      expect(m3?.categoriaId).toBe(categoriaDestinoId);

      // Garante que o movimento do outro usuário NUNCA foi alterado
      const mOutro = await prisma.movimento.findUnique({ where: { id: movBId } });
      expect(mOutro?.categoriaId).toBeNull();
    });
  });
});

