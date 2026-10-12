import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';

describe('Mapeamento de Dívidas e Compromissos Recorrentes (TASK-06)', () => {
  let app: FastifyInstance;

  const testUser = {
    nome: 'Usuario Compromissos Teste',
    email: `compromissos_${Date.now()}@teste.com`,
    senha: 'SenhaForte123!',
    rendaBaseMensal: 10000.0,
  };

  const secondUser = {
    nome: 'Usuario Invasor Compromissos',
    email: `invasor_comp_${Date.now()}@teste.com`,
    senha: 'SenhaForte456!',
    rendaBaseMensal: 4000.0,
  };

  let tokenUser: string;
  let userId: string;
  let tokenInvasor: string;
  let invasorId: string;

  let cartaoCreditoId: string;
  let categoriaMoradiaId: string;
  let categoriaServicosDigitaisId: string;

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

    // 3. Criar cartão de crédito para o usuário principal (dia vencimento 15)
    const respCartao = await app.inject({
      method: 'POST',
      url: '/api/contas',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload: {
        nome: 'Cartão Platinum',
        tipo: 'CARTAO_CREDITO',
        diaFechamento: 8,
        diaVencimento: 15,
        saldoInicial: 0,
      },
    });
    cartaoCreditoId = JSON.parse(respCartao.body).conta.id;

    // 4. Buscar categorias do seed
    const categorias = await prisma.categoria.findMany({
      where: { usuarioId: null },
      take: 5,
    });
    categoriaMoradiaId = categorias[0]?.id;
    categoriaServicosDigitaisId = categorias[1]?.id;
  });

  afterAll(async () => {
    // Limpeza dos usuários de teste em cascata
    if (userId) {
      await prisma.usuario.delete({ where: { id: userId } }).catch(() => {});
    }
    if (invasorId) {
      await prisma.usuario.delete({ where: { id: invasorId } }).catch(() => {});
    }
    await app.close();
  });

  describe('1. CRUD de Compromissos Recorrentes (/api/recorrencias)', () => {
    let recorrenciaId: string;

    it('deve criar uma recorrência essencial (ex: Aluguel/Condomínio)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/recorrencias',
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          descricao: 'Aluguel do Apartamento',
          valorReferencia: 2500.0,
          diaPrevisto: 10,
          formaPagamento: 'Boleto Bancário',
          essencial: true,
          categoriaId: categoriaMoradiaId,
        },
      });

      expect(response.statusCode).toBe(201);
      const data = JSON.parse(response.body);
      expect(data.recorrencia).toBeDefined();
      expect(data.recorrencia.descricao).toBe('Aluguel do Apartamento');
      expect(data.recorrencia.valorReferencia).toBe(2500);
      expect(data.recorrencia.essencial).toBe(true);
      expect(data.recorrencia.status).toBe('ATIVA');
      recorrenciaId = data.recorrencia.id;
    });

    it('deve criar uma recorrência ajustável (ex: Assinatura Streaming)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/recorrencias',
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          descricao: 'Netflix & Spotify',
          valorReferencia: 95.9,
          diaPrevisto: 20,
          formaPagamento: 'Cartão de Crédito',
          essencial: false,
          categoriaId: categoriaServicosDigitaisId,
        },
      });

      expect(response.statusCode).toBe(201);
      const data = JSON.parse(response.body);
      expect(data.recorrencia.essencial).toBe(false);
    });

    it('deve listar as recorrências do usuário com filtro por essencial', async () => {
      const respTodas = await app.inject({
        method: 'GET',
        url: '/api/recorrencias',
        headers: { authorization: `Bearer ${tokenUser}` },
      });
      expect(respTodas.statusCode).toBe(200);
      const dataTodas = JSON.parse(respTodas.body);
      expect(dataTodas.recorrencias.length).toBe(2);

      const respEssenciais = await app.inject({
        method: 'GET',
        url: '/api/recorrencias?essencial=true',
        headers: { authorization: `Bearer ${tokenUser}` },
      });
      const dataEssenciais = JSON.parse(respEssenciais.body);
      expect(dataEssenciais.recorrencias.length).toBe(1);
      expect(dataEssenciais.recorrencias[0].descricao).toBe('Aluguel do Apartamento');
    });

    it('deve atualizar uma recorrência existente', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/recorrencias/${recorrenciaId}`,
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          valorReferencia: 2600.0,
          diaPrevisto: 12,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.recorrencia.valorReferencia).toBe(2600);
      expect(data.recorrencia.diaPrevisto).toBe(12);
    });

    it('não deve permitir que outro usuário altere ou exclua a recorrência (Isolamento)', async () => {
      const respUpdateInvasor = await app.inject({
        method: 'PUT',
        url: `/api/recorrencias/${recorrenciaId}`,
        headers: { authorization: `Bearer ${tokenInvasor}` },
        payload: { valorReferencia: 1.0 },
      });
      expect(respUpdateInvasor.statusCode).toBe(404);

      const respDeleteInvasor = await app.inject({
        method: 'DELETE',
        url: `/api/recorrencias/${recorrenciaId}`,
        headers: { authorization: `Bearer ${tokenInvasor}` },
      });
      expect(respDeleteInvasor.statusCode).toBe(404);
    });
  });

  describe('2. Motor de Parcelamentos e Saldo Devedor (/api/parcelamentos)', () => {
    let parcelamentoId: string;

    it('deve cadastrar um parcelamento com cálculo automático de último vencimento e valor da parcela', async () => {
      // Ex: Geladeira R$ 3.000 em 10x de R$ 300, começando em 2026-08, parcela atual 3 (ou seja, 2026-10)
      const response = await app.inject({
        method: 'POST',
        url: '/api/parcelamentos',
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          descricao: 'Geladeira Frost Free',
          valorTotal: 3000.0,
          parcelaAtual: 3,
          totalParcelas: 10,
          primeiroVencimento: '2026-08',
          contaId: cartaoCreditoId,
        },
      });

      expect(response.statusCode).toBe(201);
      const data = JSON.parse(response.body);
      expect(data.parcelamento).toBeDefined();
      expect(data.parcelamento.parcelaValor).toBe(300);
      // 10 parcelas começando em 08/2026: 08, 09, 10, 11, 12, 01, 02, 03, 04, 05 -> 2027-05
      expect(data.parcelamento.ultimoVencimento).toBe('2027-05');
      // Parcela 3 de 10: restam 8 parcelas (3, 4, 5, 6, 7, 8, 9, 10)
      expect(data.parcelamento.parcelasRestantes).toBe(8);
      // Saldo devedor: 8 * 300 = 2400
      expect(data.parcelamento.saldoDevedorRestante).toBe(2400);

      parcelamentoId = data.parcelamento.id;
    });

    it('deve listar parcelamentos calculando o saldo devedor total acumulado com exatidão', async () => {
      // Cadastrar segundo parcelamento: Notebook R$ 2.000 em 4x de R$ 500, parcela atual 1, início 2026-10
      await app.inject({
        method: 'POST',
        url: '/api/parcelamentos',
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          descricao: 'Notebook Trabalho',
          valorTotal: 2000.0,
          parcelaValor: 500.0,
          parcelaAtual: 1,
          totalParcelas: 4,
          primeiroVencimento: '2026-10',
          contaId: cartaoCreditoId,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/parcelamentos',
        headers: { authorization: `Bearer ${tokenUser}` },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.totalParcelamentosAtivos).toBe(2);
      // Geladeira: 2400 + Notebook: 4 * 500 = 2000 -> Total: 4400
      expect(data.saldoDevedorTotalGeral).toBe(4400);
    });

    it('deve rejeitar parcelamento com parcelaAtual maior que totalParcelas', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/parcelamentos',
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          descricao: 'Inválido',
          valorTotal: 1000,
          parcelaAtual: 5,
          totalParcelas: 3,
          primeiroVencimento: '2026-10',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('3. Cronograma Unificado de Vencimentos (/api/compromissos/vencimentos)', () => {
    it('deve retornar o cronograma unificado para a competência 2026-10 com recorrências e parcelas ordenadas por dia', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/compromissos/vencimentos?competencia=2026-10',
        headers: { authorization: `Bearer ${tokenUser}` },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);

      expect(data.competencia).toBe('2026-10');
      expect(data.totalPrevistoMes).toBeGreaterThan(0);
      expect(data.itens.length).toBeGreaterThan(0);

      // Verificar ordenação cronológica estrita por dia de vencimento
      for (let i = 0; i < data.itens.length - 1; i++) {
        expect(data.itens[i].diaVencimento).toBeLessThanOrEqual(data.itens[i + 1].diaVencimento);
      }

      // Verificar que itens de parcelamento contêm info de número de parcela
      const itensParcelamento = data.itens.filter((item: any) => item.tipo === 'PARCELAMENTO');
      expect(itensParcelamento.length).toBe(2);

      const geladeira = itensParcelamento.find((item: any) => item.descricao.includes('Geladeira'));
      expect(geladeira).toBeDefined();
      expect(geladeira.diaVencimento).toBe(15); // dia vencimento do cartão
      expect(geladeira.dataVencimentoPrevista).toBe('2026-10-15');
      // Em 2026-10, começou em 2026-08 (diff = 2) -> parcela 3/10
      expect(geladeira.parcelamentoInfo.parcelaAtualNoMes).toBe(3);
      expect(geladeira.parcelamentoInfo.totalParcelas).toBe(10);
      // Restam 7 parcelas após o mês atual pago -> 7 * 300 = 2100
      expect(geladeira.parcelamentoInfo.saldoDevedorRestanteAposMes).toBe(2100);

      // Verificar que recorrências estão no cronograma
      const itensRecorrencia = data.itens.filter((item: any) => item.tipo === 'RECORRENCIA');
      expect(itensRecorrencia.length).toBe(2);
    });

    it('não deve incluir no cronograma parcelamentos já finalizados antes da competência consultada', async () => {
      // Competência bem no futuro: 2028-01 (ambos já terminaram)
      const response = await app.inject({
        method: 'GET',
        url: '/api/compromissos/vencimentos?competencia=2028-01',
        headers: { authorization: `Bearer ${tokenUser}` },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      const parcelamentos = data.itens.filter((i: any) => i.tipo === 'PARCELAMENTO');
      expect(parcelamentos.length).toBe(0);
      // As recorrências continuam ativas
      const recorrencias = data.itens.filter((i: any) => i.tipo === 'RECORRENCIA');
      expect(recorrencias.length).toBe(2);
    });
  });
});
