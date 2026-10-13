import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { buildApp } from '../../../app.js';
import { prisma } from '../../../infrastructure/database/prisma.js';
import {
  openFinanceEventBus,
  OpenFinanceEventBus,
  OpenFinanceProcessedEvent,
} from '../../../infrastructure/events/open-finance-event-bus.js';
import { openFinanceWorkerService } from './open-finance-worker.service.js';

describe('TASK-29: Worker Assíncrono Orientado a Eventos para Processamento e Conciliação de Dados Brutos', () => {
  let app: FastifyInstance;
  let usuario1Id: string;
  let token1: string;
  let conexao1Id: string;

  let usuario2Id: string;
  let token2: string;
  let conexao2Id: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Criar Usuário 1
    const email1 = `wrk-test1-${Date.now()}@evolvi.app`;
    const cad1 = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario Worker Test 1',
        email: email1,
        senha: 'SenhaForte123!',
      },
    });
    const body1 = JSON.parse(cad1.body);
    usuario1Id = body1.usuario.id;
    token1 = body1.token;

    // Criar conexão bancária para Usuário 1
    const conn1 = await app.inject({
      method: 'POST',
      url: '/api/conectores/conexoes',
      headers: { authorization: `Bearer ${token1}` },
      payload: {
        instituicaoCodigo: 'CON-HUB',
        consentimentoConfirmado: true,
        escopo: ['contas', 'extratos'],
        credentials: {
          clientId: 'client-wrk-1',
          certificadoThumbprint: 'thumbprint-1',
        },
      },
    });
    conexao1Id = JSON.parse(conn1.body).conexao.id;

    // 2. Criar Usuário 2 (para testes de isolamento multi-tenant)
    const email2 = `wrk-test2-${Date.now()}@evolvi.app`;
    const cad2 = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario Worker Test 2',
        email: email2,
        senha: 'SenhaForte123!',
      },
    });
    const body2 = JSON.parse(cad2.body);
    usuario2Id = body2.usuario.id;
    token2 = body2.token;

    const conn2 = await app.inject({
      method: 'POST',
      url: '/api/conectores/conexoes',
      headers: { authorization: `Bearer ${token2}` },
      payload: {
        instituicaoCodigo: 'CON-HUB',
        consentimentoConfirmado: true,
        escopo: ['contas', 'extratos'],
        credentials: {
          clientId: 'client-wrk-2',
          certificadoThumbprint: 'thumbprint-2',
        },
      },
    });
    conexao2Id = JSON.parse(conn2.body).conexao.id;
  });

  afterAll(async () => {
    openFinanceWorkerService.stop();
    if (usuario1Id) {
      await prisma.movimento.deleteMany({ where: { usuarioId: usuario1Id } });
      await prisma.conta.deleteMany({ where: { usuarioId: usuario1Id } });
      await prisma.dadoBrutoOpenFinance.deleteMany({ where: { usuarioId: usuario1Id } });
      await prisma.conexaoBancaria.deleteMany({ where: { usuarioId: usuario1Id } });
      await prisma.configuracaoUsuario.deleteMany({ where: { usuarioId: usuario1Id } });
      await prisma.usuario.deleteMany({ where: { id: usuario1Id } });
    }
    if (usuario2Id) {
      await prisma.movimento.deleteMany({ where: { usuarioId: usuario2Id } });
      await prisma.conta.deleteMany({ where: { usuarioId: usuario2Id } });
      await prisma.dadoBrutoOpenFinance.deleteMany({ where: { usuarioId: usuario2Id } });
      await prisma.conexaoBancaria.deleteMany({ where: { usuarioId: usuario2Id } });
      await prisma.configuracaoUsuario.deleteMany({ where: { usuarioId: usuario2Id } });
      await prisma.usuario.deleteMany({ where: { id: usuario2Id } });
    }
    await app.close();
  });

  describe('1. Reação ao Ping e Processamento de Contas e Transações Brutas', () => {
    it('deve processar dado bruto de CONTAS provisionando conta bancária com sucesso', async () => {
      const hashCarga = crypto.randomUUID();
      const payloadContas = [
        {
          idExterno: 'acc-wrk-101',
          nome: 'Conta Corrente Worker Test',
          tipo: 'CONTA_CORRENTE',
          saldoAtual: 3500.5,
        },
      ];

      const dadoBruto = await prisma.dadoBrutoOpenFinance.create({
        data: {
          usuarioId: usuario1Id,
          conexaoId: conexao1Id,
          instituicaoCodigo: 'CON-HUB',
          tipoDado: 'CONTAS',
          payloadRaw: payloadContas as any,
          hashCarga,
          status: 'PENDENTE_PROCESSAMENTO',
        },
      });

      const resultado = await openFinanceWorkerService.processarRegistroDadoBruto(dadoBruto.id, usuario1Id);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.tipoDado).toBe('CONTAS');

      // Verificar transição no banco para PROCESSADO
      const atualizado = await prisma.dadoBrutoOpenFinance.findUnique({
        where: { id: dadoBruto.id },
      });
      expect(atualizado?.status).toBe('PROCESSADO');
      expect(atualizado?.processadoEm).not.toBeNull();

      // Verificar se a conta bancária foi criada no escopo do usuário 1
      const contaCriada = await prisma.conta.findFirst({
        where: {
          usuarioId: usuario1Id,
          nome: 'Conta Corrente Worker Test',
        },
      });
      expect(contaCriada).not.toBeNull();
      expect(Number(contaCriada?.saldoInicial)).toBe(3500.5);
    });

    it('deve processar TRANSACOES brutas, deduplicar determinística e aplicar anti-dupla contagem', async () => {
      // 1. Criar conta bancária prévia
      const conta = await prisma.conta.create({
        data: {
          usuarioId: usuario1Id,
          nome: 'Conta Transacoes Test',
          tipo: 'CONTA_CORRENTE',
          saldoInicial: 1000,
        },
      });

      const hashTrans = crypto.randomUUID();
      const payloadTrans = {
        contaIdExterno: 'acc-tx-1',
        contaNome: conta.nome,
        tipoConta: 'CONTA_CORRENTE',
        transacoes: [
          {
            idExterno: 'tx-wrk-001',
            data: '2026-09-10',
            descricao: 'Supermercado Central Alimentos',
            valor: 180.5,
            natureza: 'DESPESA',
            categoriaSugerida: 'Alimentação',
          },
          {
            idExterno: 'tx-wrk-002',
            data: '2026-09-11',
            descricao: 'Pagamento de Fatura Cartao Nubank',
            valor: 1250.0,
            natureza: 'DESPESA',
            isPagamentoFatura: true, // Anti-dupla contagem!
          },
        ],
      };

      const dadoBrutoTrans = await prisma.dadoBrutoOpenFinance.create({
        data: {
          usuarioId: usuario1Id,
          conexaoId: conexao1Id,
          instituicaoCodigo: 'CON-HUB',
          tipoDado: 'TRANSACOES',
          payloadRaw: payloadTrans as any,
          hashCarga: hashTrans,
          status: 'PENDENTE_PROCESSAMENTO',
        },
      });

      // Capturar evento emitido no barramento
      let eventoDisparado: OpenFinanceProcessedEvent | null = null;
      openFinanceEventBus.once(OpenFinanceEventBus.EVENT_PROCESSED_SUCCESS, (ev) => {
        eventoDisparado = ev;
      });

      const resultado = await openFinanceWorkerService.processarRegistroDadoBruto(dadoBrutoTrans.id, usuario1Id);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.novosMovimentosInseridos).toBe(2);
      expect(resultado.pagamentosFaturaConvertidos).toBe(1);

      // Verificar evento no barramento
      expect(eventoDisparado).not.toBeNull();
      expect(eventoDisparado?.dadosBrutosId).toBe(dadoBrutoTrans.id);
      expect(eventoDisparado?.novosMovimentosInseridos).toBe(2);

      // Verificar conversão para TRANSFERENCIA_PROPRIA
      const movFatura = await prisma.movimento.findFirst({
        where: {
          usuarioId: usuario1Id,
          descricao: { contains: 'Pagamento de Fatura' },
        },
      });
      expect(movFatura?.natureza).toBe('TRANSFERENCIA_PROPRIA');

      // Reprocessar o mesmo lote não deve reinserir duplicatas (deduplicação determinística)
      const resDedupe = await openFinanceWorkerService.processarRegistroDadoBruto(dadoBrutoTrans.id, usuario1Id);
      // Como já estava PROCESSADO, o worker ignora com segurança
      expect(resDedupe.novosMovimentosInseridos).toBe(0);
    });

    it('deve processar FATURAS brutas de cartão e gerar lançamentos no cartão correspondente', async () => {
      const hashFat = crypto.randomUUID();
      const payloadFat = {
        cartaoIdExterno: 'card-wrk-1',
        faturas: [
          {
            idExterno: 'fat-wrk-2026-09',
            cartaoNome: 'Cartão Worker Platinum',
            competencia: '2026-09',
            dataFechamento: '2026-09-20',
            dataVencimento: '2026-09-28',
            valorTotal: 450.0,
            status: 'FECHADA',
            lancamentos: [
              {
                idExterno: 'tx-card-001',
                data: '2026-09-05',
                descricao: 'Restaurante Sabor Brasil',
                valor: 150.0,
                natureza: 'DESPESA',
                categoriaSugerida: 'Alimentação',
              },
              {
                idExterno: 'tx-card-002',
                data: '2026-09-12',
                descricao: 'Combustível Posto Shell',
                valor: 300.0,
                natureza: 'DESPESA',
                categoriaSugerida: 'Transporte',
              },
            ],
          },
        ],
      };

      const dadoBrutoFat = await prisma.dadoBrutoOpenFinance.create({
        data: {
          usuarioId: usuario1Id,
          conexaoId: conexao1Id,
          instituicaoCodigo: 'CON-HUB',
          tipoDado: 'FATURAS',
          payloadRaw: payloadFat as any,
          hashCarga: hashFat,
          status: 'PENDENTE_PROCESSAMENTO',
        },
      });

      const resultado = await openFinanceWorkerService.processarRegistroDadoBruto(dadoBrutoFat.id, usuario1Id);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.novosMovimentosInseridos).toBe(2);

      // Verificar se a conta de cartão foi provisionada
      const contaCartao = await prisma.conta.findFirst({
        where: {
          usuarioId: usuario1Id,
          nome: 'Cartão Worker Platinum',
        },
      });
      expect(contaCartao?.tipo).toBe('CARTAO_CREDITO');

      // Verificar movimentos vinculados à conta de cartão
      const movsCartao = await prisma.movimento.findMany({
        where: {
          usuarioId: usuario1Id,
          contaId: contaCartao?.id,
        },
      });
      expect(movsCartao.length).toBe(2);
    });
  });

  describe('2. Recuperação de Falhas, Política de Retries e Dead Letter Queue (DLQ)', () => {
    it('deve incrementar tentativas e enviar para DLQ (ERRO_PROCESSAMENTO) após atingir maxRetries', async () => {
      // Inserir registro com payload deliberadamente inválido para forçar falha no parser
      const hashInvalido = crypto.randomUUID();
      const dadoBrutoFalha = await prisma.dadoBrutoOpenFinance.create({
        data: {
          usuarioId: usuario1Id,
          conexaoId: conexao1Id,
          instituicaoCodigo: 'CON-HUB',
          tipoDado: 'TRANSACOES',
          payloadRaw: { transacoes: 'STRING_INVALIDA_NAO_ARRAY' } as any, // Causa erro ao iterar
          hashCarga: hashInvalido,
          status: 'PENDENTE_PROCESSAMENTO',
          tentativas: 2, // Já tentou 2 vezes, a próxima (3) deve cair na DLQ
        },
      });

      const res = await openFinanceWorkerService.processarRegistroDadoBruto(dadoBrutoFalha.id, usuario1Id);

      expect(res.sucesso).toBe(false);
      expect(res.tentativas).toBe(3);
      expect(res.enviadoParaDLQ).toBe(true);

      const noBanco = await prisma.dadoBrutoOpenFinance.findUnique({
        where: { id: dadoBrutoFalha.id },
      });
      expect(noBanco?.status).toBe('ERRO_PROCESSAMENTO');
      expect(noBanco?.mensagemErro).not.toBeNull();
    });

    it('deve permitir reprocessamento de itens da DLQ sob demanda via reprocessarDLQ', async () => {
      // Localizar o item que caiu na DLQ
      const itemDLQ = await prisma.dadoBrutoOpenFinance.findFirst({
        where: {
          usuarioId: usuario1Id,
          status: 'ERRO_PROCESSAMENTO',
        },
      });
      expect(itemDLQ).not.toBeNull();

      // Ajustar o payload do item para se tornar válido antes do reprocessamento
      await prisma.dadoBrutoOpenFinance.update({
        where: { id: itemDLQ!.id },
        data: {
          payloadRaw: {
            contaNome: 'Conta Corrigida DLQ',
            transacoes: [
              {
                idExterno: 'tx-dlq-fixed-01',
                data: '2026-09-15',
                descricao: 'Transação Recuperada da DLQ',
                valor: 89.9,
                natureza: 'DESPESA',
              },
            ],
          } as any,
        },
      });

      const resultadosDLQ = await openFinanceWorkerService.reprocessarDLQ(itemDLQ!.id, usuario1Id);

      expect(resultadosDLQ.length).toBe(1);
      expect(resultadosDLQ[0].sucesso).toBe(true);
      expect(resultadosDLQ[0].novosMovimentosInseridos).toBe(1);

      const recuperado = await prisma.dadoBrutoOpenFinance.findUnique({
        where: { id: itemDLQ!.id },
      });
      expect(recuperado?.status).toBe('PROCESSADO');
    });

    it('deve executar sweep de segurança periódica recuperando registros PENDENTE_PROCESSAMENTO', async () => {
      // Criar 2 registros pendentes
      const h1 = crypto.randomUUID();
      const h2 = crypto.randomUUID();

      await prisma.dadoBrutoOpenFinance.createMany({
        data: [
          {
            usuarioId: usuario1Id,
            conexaoId: conexao1Id,
            instituicaoCodigo: 'CON-HUB',
            tipoDado: 'CONTAS',
            payloadRaw: [{ idExterno: 'sweep-acc-1', nome: 'Conta Sweep 1', tipo: 'CONTA_CORRENTE' }] as any,
            hashCarga: h1,
            status: 'PENDENTE_PROCESSAMENTO',
          },
          {
            usuarioId: usuario1Id,
            conexaoId: conexao1Id,
            instituicaoCodigo: 'CON-HUB',
            tipoDado: 'CONTAS',
            payloadRaw: [{ idExterno: 'sweep-acc-2', nome: 'Conta Sweep 2', tipo: 'CONTA_CORRENTE' }] as any,
            hashCarga: h2,
            status: 'PENDENTE_PROCESSAMENTO',
          },
        ],
      });

      const sweepRes = await openFinanceWorkerService.executarSweepSeguranca();

      expect(sweepRes.totalPendentesEncontrados).toBeGreaterThanOrEqual(2);
      expect(sweepRes.processadosSucesso).toBeGreaterThanOrEqual(2);
    });
  });

  describe('3. Garantia de Isolamento Multi-Tenant e Endpoints REST do Worker', () => {
    it('deve bloquear estritamente tentativa de processar dado bruto de outro usuário (multi-tenant)', async () => {
      // Criar dado bruto pertencente ao Usuário 2
      const hashUser2 = crypto.randomUUID();
      const dadoUser2 = await prisma.dadoBrutoOpenFinance.create({
        data: {
          usuarioId: usuario2Id,
          conexaoId: conexao2Id,
          instituicaoCodigo: 'CON-HUB',
          tipoDado: 'CONTAS',
          payloadRaw: [{ idExterno: 'u2-acc-1', nome: 'Conta Secreta U2', tipo: 'CONTA_CORRENTE' }] as any,
          hashCarga: hashUser2,
          status: 'PENDENTE_PROCESSAMENTO',
        },
      });

      // Tentar processar passando usuarioIdEsperado = usuario1Id
      await expect(
        openFinanceWorkerService.processarRegistroDadoBruto(dadoUser2.id, usuario1Id)
      ).rejects.toThrow(/Violação de isolamento multi-tenant/);

      // Endpoint REST com token do Usuário 1 tentando acessar dado do Usuário 2 deve falhar
      const resApi = await app.inject({
        method: 'POST',
        url: `/api/conectores/worker/processar/${dadoUser2.id}`,
        headers: { authorization: `Bearer ${token1}` },
      });

      expect(resApi.statusCode).toBe(400);
      expect(JSON.parse(resApi.body).message).toMatch(/Violação de isolamento multi-tenant/);
    });

    it('deve disparar sweep e reprocessamento DLQ através das rotas REST autenticadas', async () => {
      const resSweep = await app.inject({
        method: 'POST',
        url: '/api/conectores/worker/sweep',
        headers: { authorization: `Bearer ${token1}` },
      });
      expect(resSweep.statusCode).toBe(200);
      expect(JSON.parse(resSweep.body).message).toBe('Sweep de segurança executado com sucesso');

      const resDLQ = await app.inject({
        method: 'POST',
        url: '/api/conectores/worker/reprocessar-dlq',
        headers: { authorization: `Bearer ${token1}` },
        payload: {},
      });
      expect(resDLQ.statusCode).toBe(200);
      expect(JSON.parse(resDLQ.body).message).toBe('Reprocessamento de registros DLQ concluído');
    });
  });
});
