import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';

describe('Gestão de Contas (E2E / Integração)', () => {
  let app: FastifyInstance;

  const userA = {
    nome: 'Usuario Contas A',
    email: `contas_a_${Date.now()}@teste.com`,
    senha: 'SenhaForte123!',
    rendaBaseMensal: 6000.0,
  };

  const userB = {
    nome: 'Usuario Contas B',
    email: `contas_b_${Date.now()}@teste.com`,
    senha: 'SenhaForte456!',
    rendaBaseMensal: 4000.0,
  };

  let tokenUserA: string;
  let tokenUserB: string;
  let idUserA: string;
  let idUserB: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Criar usuários de teste e obter tokens
    const respA = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: userA,
    });
    const bodyA = JSON.parse(respA.body);
    tokenUserA = bodyA.token;
    idUserA = bodyA.usuario.id;

    const respB = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: userB,
    });
    const bodyB = JSON.parse(respB.body);
    tokenUserB = bodyB.token;
    idUserB = bodyB.usuario.id;
  });

  afterAll(async () => {
    if (idUserA || idUserB) {
      await prisma.usuario.deleteMany({
        where: {
          id: { in: [idUserA, idUserB].filter(Boolean) },
        },
      });
    }
    await app.close();
  });

  describe('Criação e Listagem de Contas', () => {
    it('deve criar uma conta corrente com sucesso', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/contas',
        headers: { authorization: `Bearer ${tokenUserA}` },
        payload: {
          nome: 'Nubank Conta Corrente',
          tipo: 'CONTA_CORRENTE',
          saldoInicial: 1500.5,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.conta).toBeDefined();
      expect(body.conta.nome).toBe('Nubank Conta Corrente');
      expect(body.conta.tipo).toBe('CONTA_CORRENTE');
      expect(body.conta.saldoInicial).toBe(1500.5);
      expect(body.conta.ativo).toBe(true);
      expect(body.conta.usuarioId).toBe(idUserA);
    });

    it('deve criar um cartão de crédito com dia de fechamento e vencimento obrigatórios', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/contas',
        headers: { authorization: `Bearer ${tokenUserA}` },
        payload: {
          nome: 'Cartão Santander SX',
          tipo: 'CARTAO_CREDITO',
          diaFechamento: 25,
          diaVencimento: 5,
          saldoInicial: 0,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.conta.nome).toBe('Cartão Santander SX');
      expect(body.conta.tipo).toBe('CARTAO_CREDITO');
      expect(body.conta.diaFechamento).toBe(25);
      expect(body.conta.diaVencimento).toBe(5);
    });

    it('deve rejeitar criação de cartão de crédito sem dias de fechamento/vencimento', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/contas',
        headers: { authorization: `Bearer ${tokenUserA}` },
        payload: {
          nome: 'Cartão Inválido',
          tipo: 'CARTAO_CREDITO',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Bad Request');
    });

    it('deve listar apenas as contas do próprio usuário autenticado (isolamento multi-tenant)', async () => {
      // Criar conta para User B
      await app.inject({
        method: 'POST',
        url: '/api/contas',
        headers: { authorization: `Bearer ${tokenUserB}` },
        payload: {
          nome: 'Conta Inter User B',
          tipo: 'CONTA_CORRENTE',
          saldoInicial: 800,
        },
      });

      // User A consulta suas contas
      const responseA = await app.inject({
        method: 'GET',
        url: '/api/contas',
        headers: { authorization: `Bearer ${tokenUserA}` },
      });

      expect(responseA.statusCode).toBe(200);
      const bodyA = JSON.parse(responseA.body);
      expect(bodyA.contas.length).toBe(2);
      expect(bodyA.contas.some((c: { nome: string }) => c.nome === 'Conta Inter User B')).toBe(false);

      // User B consulta suas contas
      const responseB = await app.inject({
        method: 'GET',
        url: '/api/contas',
        headers: { authorization: `Bearer ${tokenUserB}` },
      });
      const bodyB = JSON.parse(responseB.body);
      expect(bodyB.contas.length).toBe(1);
      expect(bodyB.contas[0].nome).toBe('Conta Inter User B');
    });
  });

  describe('Atualização e Exclusão com Bloqueio de Integridade', () => {
    it('deve atualizar dados de uma conta existente', async () => {
      const createResp = await app.inject({
        method: 'POST',
        url: '/api/contas',
        headers: { authorization: `Bearer ${tokenUserA}` },
        payload: {
          nome: 'Conta Para Atualizar',
          tipo: 'CARTEIRA_DINHEIRO',
          saldoInicial: 100,
        },
      });
      const createdConta = JSON.parse(createResp.body).conta;

      const updateResp = await app.inject({
        method: 'PUT',
        url: `/api/contas/${createdConta.id}`,
        headers: { authorization: `Bearer ${tokenUserA}` },
        payload: {
          nome: 'Carteira Dinheiro Físico',
          saldoInicial: 250.75,
        },
      });

      expect(updateResp.statusCode).toBe(200);
      const updatedBody = JSON.parse(updateResp.body);
      expect(updatedBody.conta.nome).toBe('Carteira Dinheiro Físico');
      expect(updatedBody.conta.saldoInicial).toBe(250.75);
    });

    it('não deve permitir que outro usuário atualize conta alheia (IDOR)', async () => {
      const createResp = await app.inject({
        method: 'POST',
        url: '/api/contas',
        headers: { authorization: `Bearer ${tokenUserA}` },
        payload: {
          nome: 'Conta Secreta Alpha',
          tipo: 'CONTA_CORRENTE',
        },
      });
      const idContaA = JSON.parse(createResp.body).conta.id;

      const updateTry = await app.inject({
        method: 'PUT',
        url: `/api/contas/${idContaA}`,
        headers: { authorization: `Bearer ${tokenUserB}` },
        payload: { nome: 'Ataque IDOR' },
      });

      expect(updateTry.statusCode).toBe(404);
    });

    it('deve excluir conta sem movimentações com sucesso', async () => {
      const createResp = await app.inject({
        method: 'POST',
        url: '/api/contas',
        headers: { authorization: `Bearer ${tokenUserA}` },
        payload: {
          nome: 'Conta Sem Histórico',
          tipo: 'INVESTIMENTO',
        },
      });
      const idConta = JSON.parse(createResp.body).conta.id;

      const deleteResp = await app.inject({
        method: 'DELETE',
        url: `/api/contas/${idConta}`,
        headers: { authorization: `Bearer ${tokenUserA}` },
      });

      expect(deleteResp.statusCode).toBe(200);
    });

    it('deve BLOQUEAR exclusão de conta caso haja movimentos vinculados (Integridade Histórica)', async () => {
      // 1. Criar conta
      const createResp = await app.inject({
        method: 'POST',
        url: '/api/contas',
        headers: { authorization: `Bearer ${tokenUserA}` },
        payload: {
          nome: 'Conta com Movimentos',
          tipo: 'CONTA_CORRENTE',
        },
      });
      const idConta = JSON.parse(createResp.body).conta.id;

      // 2. Inserir movimento vinculado à conta
      await prisma.movimento.create({
        data: {
          usuarioId: idUserA,
          contaId: idConta,
          dataMovimento: new Date(),
          competencia: '2026-09',
          descricao: 'Gasto de teste para proteção de histórico',
          valor: 50.0,
          natureza: 'DESPESA',
        },
      });

      // 3. Tentar excluir a conta
      const deleteResp = await app.inject({
        method: 'DELETE',
        url: `/api/contas/${idConta}`,
        headers: { authorization: `Bearer ${tokenUserA}` },
      });

      expect(deleteResp.statusCode).toBe(409);
      const errorBody = JSON.parse(deleteResp.body);
      expect(errorBody.error).toBe('Conflict');
      expect(errorBody.message).toContain('movimentações ou parcelamentos vinculados');

      // Limpar movimento de teste
      await prisma.movimento.deleteMany({
        where: { contaId: idConta },
      });
      // Agora a exclusão deve funcionar
      const retryDelete = await app.inject({
        method: 'DELETE',
        url: `/api/contas/${idConta}`,
        headers: { authorization: `Bearer ${tokenUserA}` },
      });
      expect(retryDelete.statusCode).toBe(200);
    });
  });
});
