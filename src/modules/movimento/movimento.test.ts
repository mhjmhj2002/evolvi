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
});
