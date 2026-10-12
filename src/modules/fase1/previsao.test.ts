import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';

describe('Motor de Previsão e Projeção 6M (M-005) - TASK-14', () => {
  let app: FastifyInstance;

  const testUser = {
    nome: 'Usuario Previsao 6M',
    email: `previsao_6m_${Date.now()}@teste.com`,
    senha: 'SenhaForte123!',
    rendaBaseMensal: 11000.0,
  };

  const secondUser = {
    nome: 'Usuario Invasor Previsao',
    email: `invasor_prev_${Date.now()}@teste.com`,
    senha: 'SenhaForte123!',
    rendaBaseMensal: 6000.0,
  };

  let tokenUser: string;
  let usuarioId: string;
  let tokenInvasor: string;
  let invasorId: string;

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
  });

  afterAll(async () => {
    if (usuarioId) {
      await prisma.usuario.delete({ where: { id: usuarioId } }).catch(() => {});
    }
    if (invasorId) {
      await prisma.usuario.delete({ where: { id: invasorId } }).catch(() => {});
    }
    await app.close();
  });

  describe('1. Projeção de 6 Meses Futuros (/api/fase1/previsao/seis-meses)', () => {
    it('deve retornar a projeção de 6 meses exatamente alinhada aos números auditados FIN-161', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/fase1/previsao/seis-meses?competenciaReferencia=2026-10&mesesProjecao=6',
        headers: { authorization: `Bearer ${tokenUser}` },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);

      expect(data.competenciaReferencia).toBe('2026-10');
      expect(data.rendaBaseMensal).toBe(11000.0);
      expect(data.mesesProjetados).toEqual([
        '2026-10',
        '2026-11',
        '2026-12',
        '2027-01',
        '2027-02',
        '2027-03',
      ]);
      expect(data.meses.length).toBe(6);

      // 1. out/2026: Parcelas R$ 3.440,03 + Recorrentes R$ 4.482,80 + Variável R$ 5.474,02 = R$ 13.396,85 | Saldo -R$ 2.396,85
      const out26 = data.meses.find((m: any) => m.competencia === '2026-10');
      expect(out26).toBeDefined();
      expect(out26.parcelamentos).toBe(3440.03);
      expect(out26.recorrentes).toBe(4482.8);
      expect(out26.variavelAuditada).toBe(5474.02);
      expect(out26.totalProjetado).toBe(13396.85);
      expect(out26.rendaBase).toBe(11000.0);
      expect(out26.saldoProjetado).toBe(-2396.85);
      expect(out26.statusSaldo).toBe('DEFICIT');

      // 2. nov/2026: Parcelas R$ 1.667,62 + Recorrentes R$ 4.482,80 + Variável R$ 5.474,02 = R$ 11.624,44 | Saldo -R$ 624,44
      const nov26 = data.meses.find((m: any) => m.competencia === '2026-11');
      expect(nov26).toBeDefined();
      expect(nov26.parcelamentos).toBe(1667.62);
      expect(nov26.recorrentes).toBe(4482.8);
      expect(nov26.variavelAuditada).toBe(5474.02);
      expect(nov26.totalProjetado).toBe(11624.44);
      expect(nov26.saldoProjetado).toBe(-624.44);
      expect(nov26.statusSaldo).toBe('DEFICIT');

      // 3. dez/2026: Parcelas R$ 1.337,30 + Recorrentes R$ 4.482,80 + Variável R$ 5.474,02 = R$ 11.294,12 | Saldo -R$ 294,12
      const dez26 = data.meses.find((m: any) => m.competencia === '2026-12');
      expect(dez26).toBeDefined();
      expect(dez26.parcelamentos).toBe(1337.3);
      expect(dez26.recorrentes).toBe(4482.8);
      expect(dez26.variavelAuditada).toBe(5474.02);
      expect(dez26.totalProjetado).toBe(11294.12);
      expect(dez26.saldoProjetado).toBe(-294.12);
      expect(dez26.statusSaldo).toBe('DEFICIT');

      // 4. jan/2027: Parcelas R$ 1.337,30 + Recorrentes R$ 4.482,80 + Variável R$ 5.474,02 = R$ 11.294,12 | Saldo -R$ 294,12
      const jan27 = data.meses.find((m: any) => m.competencia === '2027-01');
      expect(jan27).toBeDefined();
      expect(jan27.parcelamentos).toBe(1337.3);
      expect(jan27.saldoProjetado).toBe(-294.12);

      // 5. fev/2027: Parcelas R$ 1.285,24 + Recorrentes R$ 4.482,80 + Variável R$ 5.474,02 = R$ 11.242,06 | Saldo -R$ 242,06
      const fev27 = data.meses.find((m: any) => m.competencia === '2027-02');
      expect(fev27).toBeDefined();
      expect(fev27.parcelamentos).toBe(1285.24);
      expect(fev27.totalProjetado).toBe(11242.06);
      expect(fev27.saldoProjetado).toBe(-242.06);

      // 6. mar/2027: Parcelas R$ 1.285,24 + Recorrentes R$ 4.482,80 + Variável R$ 5.474,02 = R$ 11.242,06 | Saldo -R$ 242,06
      const mar27 = data.meses.find((m: any) => m.competencia === '2027-03');
      expect(mar27).toBeDefined();
      expect(mar27.parcelamentos).toBe(1285.24);
      expect(mar27.totalProjetado).toBe(11242.06);
      expect(mar27.saldoProjetado).toBe(-242.06);
    });

    it('deve respeitar parcelamentos e recorrências dinâmicos cadastrados pelo usuário no banco', async () => {
      // Cadastrar uma conta de cartão
      const respCartao = await app.inject({
        method: 'POST',
        url: '/api/contas',
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          nome: 'Cartão Master Teste',
          tipo: 'CARTAO_CREDITO',
          diaFechamento: 20,
          diaVencimento: 10,
          saldoInicial: 0,
        },
      });
      const cartaoId = JSON.parse(respCartao.body).conta.id;

      // Cadastrar um parcelamento ativo: 4 parcelas de R$ 250 de 2026-10 a 2027-01
      await app.inject({
        method: 'POST',
        url: '/api/parcelamentos',
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          descricao: 'Curso Especializado',
          valorTotal: 1000.0,
          parcelaValor: 250.0,
          parcelaAtual: 1,
          totalParcelas: 4,
          primeiroVencimento: '2026-10',
          contaId: cartaoId,
        },
      });

      // Cadastrar uma recorrência ativa: R$ 300 de condomínio
      await app.inject({
        method: 'POST',
        url: '/api/recorrencias',
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          descricao: 'Condomínio Mensal',
          valorReferencia: 300.0,
          diaPrevisto: 10,
          essencial: true,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/fase1/previsao/seis-meses?competenciaReferencia=2026-10&mesesProjecao=6',
        headers: { authorization: `Bearer ${tokenUser}` },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);

      // Em 2026-10: parcelas = 250, recorrentes = 300, variavel = 5474.02
      const m1 = data.meses.find((m: any) => m.competencia === '2026-10');
      expect(m1.parcelamentos).toBe(250.0);
      expect(m1.recorrentes).toBe(300.0);
      expect(m1.variavelAuditada).toBe(5474.02);
      expect(m1.totalProjetado).toBe(6024.02);
      expect(m1.saldoProjetado).toBe(4975.98); // Renda 11.000 - 6.024,02 = +4.975,98
      expect(m1.statusSaldo).toBe('SUPERAVIT');

      // Em 2027-02 (mês 5): o parcelamento de 4 meses já encerrou (era out, nov, dez, jan)
      const m5 = data.meses.find((m: any) => m.competencia === '2027-02');
      expect(m5.parcelamentos).toBe(0.0);
      expect(m5.recorrentes).toBe(300.0);
      expect(m5.totalProjetado).toBe(5774.02);
      expect(m5.saldoProjetado).toBe(5225.98);
    });
  });

  describe('2. Decomposição Detalhada por Categoria (/api/fase1/previsao/decomposicao-categorias)', () => {
    it('deve retornar as categorias com as 3 camadas decompostas e ordenadas por valor projetado', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/fase1/previsao/decomposicao-categorias?competencia=2026-10',
        headers: { authorization: `Bearer ${tokenInvasor}` },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);

      expect(data.competencia).toBe('2026-10');
      expect(data.rendaBase).toBe(6000.0);
      expect(data.categorias.length).toBe(21);

      // Moradia em out/26 no modelo canônico: Recorrentes R$ 2.353,41, Parcelas R$ 1.128,70, Variável R$ 177,03 = Total R$ 3.659,14
      const moradia = data.categorias.find((c: any) => c.nome === 'Moradia');
      expect(moradia).toBeDefined();
      expect(moradia.recorrentes).toBe(2353.41);
      expect(moradia.parcelas).toBe(1128.7);
      expect(moradia.variavelAuditada).toBe(177.03);
      expect(moradia.totalProjetado).toBe(3659.14);

      // Alimentação em out/26: Recorrentes R$ 0, Parcelas R$ 543,66, Variável R$ 3.345,06 = Total R$ 3.888,72
      const alimentacao = data.categorias.find((c: any) => c.nome === 'Alimentacao');
      expect(alimentacao).toBeDefined();
      expect(alimentacao.parcelas).toBe(543.66);
      expect(alimentacao.variavelAuditada).toBe(3345.06);
      expect(alimentacao.totalProjetado).toBe(3888.72);

      // Educação em out/26: Recorrentes R$ 1.621,83, Parcelas R$ 386,30, Variável R$ 44,36 = Total R$ 2.052,49
      const educacao = data.categorias.find((c: any) => c.nome === 'Educacao');
      expect(educacao).toBeDefined();
      expect(educacao.recorrentes).toBe(1621.83);
      expect(educacao.parcelas).toBe(386.3);
      expect(educacao.variavelAuditada).toBe(44.36);
      expect(educacao.totalProjetado).toBe(2052.49);

      // Total previsto no mês = 13.396,85
      expect(data.totalPrevistoMes).toBe(13396.85);
      expect(data.totalRecorrentes).toBe(4482.8);
      expect(data.totalParcelas).toBe(3440.03);
      expect(data.totalVariavel).toBe(5474.02);
    });

    it('deve rejeitar requisição sem competência informada', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/fase1/previsao/decomposicao-categorias',
        headers: { authorization: `Bearer ${tokenUser}` },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('3. Calibração da Camada Variável Auditada (PUT /api/fase1/previsao/variavel-auditada)', () => {
    it('deve permitir calibrar e ajustar o consumo de uma categoria variável', async () => {
      // Ajustar Lazer de R$ 91,62 para R$ 150,00
      const putResp = await app.inject({
        method: 'PUT',
        url: '/api/fase1/previsao/variavel-auditada',
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          ajustes: [
            {
              categoriaNome: 'Lazer',
              valor: 150.0,
            },
          ],
        },
      });

      expect(putResp.statusCode).toBe(200);
      const putData = JSON.parse(putResp.body);
      expect(putData.variavelAuditada['Lazer']).toBe(150.0);

      // Verificar reflexo imediato na decomposição
      const getResp = await app.inject({
        method: 'GET',
        url: '/api/fase1/previsao/decomposicao-categorias?competencia=2026-10',
        headers: { authorization: `Bearer ${tokenUser}` },
      });

      expect(getResp.statusCode).toBe(200);
      const getData = JSON.parse(getResp.body);
      const lazer = getData.categorias.find((c: any) => c.nome === 'Lazer');
      expect(lazer.variavelAuditada).toBe(150.0);
    });
  });

  describe('4. Isolamento Multi-tenant', () => {
    it('garante que a renda base de um usuário não impacta a do outro', async () => {
      const respUser = await app.inject({
        method: 'GET',
        url: '/api/fase1/previsao/seis-meses?competenciaReferencia=2026-10',
        headers: { authorization: `Bearer ${tokenUser}` },
      });
      const dataUser = JSON.parse(respUser.body);
      expect(dataUser.rendaBaseMensal).toBe(11000.0);

      const respInvasor = await app.inject({
        method: 'GET',
        url: '/api/fase1/previsao/seis-meses?competenciaReferencia=2026-10',
        headers: { authorization: `Bearer ${tokenInvasor}` },
      });
      const dataInvasor = JSON.parse(respInvasor.body);
      expect(dataInvasor.rendaBaseMensal).toBe(6000.0);
    });
  });
});
