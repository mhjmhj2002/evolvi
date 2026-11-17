import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { contaPagarService } from './conta-pagar.service.js';

describe('Sincronização Idempotente e Ciclo Mensal Automático de Contas a Pagar', () => {
  let app: FastifyInstance;
  let usuarioId: string;
  let tokenUser: string;
  const email = `test-recorrencias-${Date.now()}@evolvi.app`;
  const senha = 'SenhaForte123!';

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();

    const resCad = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario Teste Recorrencia',
        email,
        senha,
      },
    });
    const cadBody = JSON.parse(resCad.payload);
    usuarioId = cadBody.usuario.id;
    tokenUser = cadBody.token;

    // Criar duas recorrências ativas
    await prisma.recorrencia.createMany({
      data: [
        {
          usuarioId,
          descricao: 'Internet Fibra Óptica',
          valorReferencia: 129.9,
          diaPrevisto: 15,
          status: 'ATIVA',
        },
        {
          usuarioId,
          descricao: 'Assinatura Streaming',
          valorReferencia: 45.0,
          diaPrevisto: 5,
          status: 'ATIVA',
        },
        {
          usuarioId,
          descricao: 'Academia Cancelada',
          valorReferencia: 100.0,
          diaPrevisto: 10,
          status: 'CANCELADA',
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.alertaSistema.deleteMany({ where: { usuarioId } });
    await prisma.controleCicloMensalContasPagar.deleteMany({ where: { usuarioId } });
    await prisma.contaPagar.deleteMany({ where: { usuarioId } });
    await prisma.recorrencia.deleteMany({ where: { usuarioId } });
    await prisma.usuario.deleteMany({ where: { id: usuarioId } });
    await app.close();
  });

  it('deve sincronizar as recorrências ativas para contas a pagar com diaVencimento', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/contas-pagar/sincronizar-recorrencias',
      headers: { authorization: `Bearer ${tokenUser}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.totalProcessadas).toBe(2); // Apenas as ATIVAS
    expect(body.totalImportadas).toBe(2);
    expect(body.totalExistentes).toBe(0);

    const contas = await prisma.contaPagar.findMany({
      where: { usuarioId },
      orderBy: { diaVencimento: 'asc' },
    });

    expect(contas.length).toBe(2);
    expect(contas[0].descricao).toBe('Assinatura Streaming');
    expect(contas[0].diaVencimento).toBe(5);
    expect(Number(contas[0].valor)).toBe(45.0);

    expect(contas[1].descricao).toBe('Internet Fibra Óptica');
    expect(contas[1].diaVencimento).toBe(15);
    expect(Number(contas[1].valor)).toBe(129.9);
  });

  it('deve ser 100% idempotente ao executar uma segunda vez (sem duplicar contas)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/contas-pagar/sincronizar-recorrencias',
      headers: { authorization: `Bearer ${tokenUser}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.totalProcessadas).toBe(2);
    expect(body.totalImportadas).toBe(0);
    expect(body.totalExistentes).toBe(2);

    // O total no banco permanece 2
    const total = await prisma.contaPagar.count({ where: { usuarioId } });
    expect(total).toBe(2);
  });

  it('deve permitir cadastrar fatura de cartão com valor variável (valor nulo/opcional) e status AGENDADO', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/contas-pagar',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload: {
        descricao: 'Fatura Nubank Ultravioleta',
        diaVencimento: 10,
        tipoContaPagar: 'FATURA_CARTAO',
        valorVariavel: true,
        status: 'AGENDADO',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.conta).toBeDefined();
    expect(body.conta.descricao).toBe('Fatura Nubank Ultravioleta');
    expect(body.conta.valor).toBeNull();
    expect(body.conta.valorVariavel).toBe(true);
    expect(body.conta.tipoContaPagar).toBe('FATURA_CARTAO');
    expect(body.conta.status).toBe('AGENDADO');
    expect(body.conta.diaVencimento).toBe(10);
  });

  it('não deve alterar contas do mês atual se a competência já foi inicializada / está em andamento', async () => {
    // 1. Simular uma conta paga no mês atual
    const contas = await prisma.contaPagar.findMany({ where: { usuarioId } });
    const contaStreaming = contas.find((c) => c.descricao === 'Assinatura Streaming')!;

    await prisma.contaPagar.update({
      where: { id: contaStreaming.id },
      data: {
        status: 'PAGO',
        dataPagamento: new Date(),
      },
    });

    // 2. Garantir que a competência atual já está registrada no controle
    const agora = new Date();
    const compAtual = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
    await prisma.controleCicloMensalContasPagar.upsert({
      where: {
        usuarioId_competencia: {
          usuarioId,
          competencia: compAtual,
        },
      },
      create: {
        usuarioId,
        competencia: compAtual,
        totalContasRenovadas: 3,
      },
      update: {},
    });

    // 3. Executar verificação para o mês atual
    const resultado = await contaPagarService.verificarERenovarCicloMensal(usuarioId, agora);
    expect(resultado.renovado).toBe(false);

    // Conta PAGA permanece PAGA
    const checkConta = await prisma.contaPagar.findUnique({ where: { id: contaStreaming.id } });
    expect(checkConta?.status).toBe('PAGO');
    expect(checkConta?.dataPagamento).not.toBeNull();
  });

  it('deve renovar automaticamente quando virar o mês (dia 01 00:00:00 da nova competência): zera status para PENDENTE e zera valor de fatura variável', async () => {
    // 1. Simular a virada do mês para o próximo mês (dia 01 às 00:00:00)
    const agora = new Date();
    const proximoAno = agora.getMonth() === 11 ? agora.getFullYear() + 1 : agora.getFullYear();
    const proximoMes = agora.getMonth() === 11 ? 1 : agora.getMonth() + 2;
    const dataViradaMes = new Date(Date.UTC(proximoAno, proximoMes - 1, 1, 0, 0, 0));
    const compProxima = `${proximoAno}-${String(proximoMes).padStart(2, '0')}`;

    // 2. Executa renovação do novo mês
    const resultado = await contaPagarService.verificarERenovarCicloMensal(usuarioId, dataViradaMes);
    expect(resultado.renovado).toBe(true);
    expect(resultado.competenciaAtual).toBe(compProxima);
    expect(resultado.totalContasRenovadas).toBe(3);

    // 3. Verificar se as contas foram renovadas com status zerado (PENDENTE)
    const contasRenovadas = await prisma.contaPagar.findMany({
      where: { usuarioId },
    });

    for (const c of contasRenovadas) {
      expect(c.status).toBe('PENDENTE');
      expect(c.dataPagamento).toBeNull();
      expect(c.competenciaReferencia).toBe(compProxima);
      const vDate = new Date(c.dataVencimento!);
      expect(vDate.getUTCFullYear()).toBe(proximoAno);
      expect(vDate.getUTCMonth() + 1).toBe(proximoMes);
    }

    // 4. Se executar novamente no mesmo novo mês, NÃO deve renovar novamente
    const segundaExecucao = await contaPagarService.verificarERenovarCicloMensal(usuarioId, dataViradaMes);
    expect(segundaExecucao.renovado).toBe(false);
  });
});
